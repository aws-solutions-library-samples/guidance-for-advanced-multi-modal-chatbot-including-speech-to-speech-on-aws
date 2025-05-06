import React, { useState } from 'react';
import { Auth } from 'aws-amplify';
import { BedrockAgentClient, 
        StartIngestionJobCommand, 
        ListIngestionJobsCommand 
} from "@aws-sdk/client-bedrock-agent";
import Select from "@cloudscape-design/components/select";
import Container from "@cloudscape-design/components/container";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import './Sidebar.css';
import FileUploader from './FileUploader';
import { useGuardrail, useInferenceConfig } from '../context/AppContext';
import Input from "@cloudscape-design/components/input";
import FormField from "@cloudscape-design/components/form-field"; 

applyMode(Mode.Dark);

const Sidebar = ({ isCollapsed, onToggleCollapse }) => {
  const [selectedOption, setSelectedOption] = useState({ 
    label: "Content Upload", 
    value: "upload" 
  });
  const [refreshStatus, setRefreshStatus] = useState({
    isLoading: false,
    message: '',
    error: null
  });
  const [statusCheck, setStatusCheck] = useState({
    isLoading: false,
    message: '',
    error: null,
    details: null
  });

  const { guardrailValue, setGuardrailValue, guardrailVersion, setGuardrailVersion } = useGuardrail();
  const { temperature, setTemperature, topP, setTopP, modelId, setModelId } = useInferenceConfig();

  const [isModelIdValid, setIsModelIdValid] = useState(true);
  const [shouldShake, setShouldShake] = useState(false); 

  const options = [
    { label: "Content Upload", value: "upload" },
    { label: "KB Refresh", value: "refresh" },
    { label: "Guardrails", value: "guardrail" },
    { label: "Inference Configuration", value: "inference" }
  ];

  const validateNumber = (value, setter) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0 && num <= 1) {
      setter(value);
    }
  };

  const validateModelId = (value) => {
    const modelIdRegex = /^(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:((:foundation-model\/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|([0-9]{12}:provisioned-model\/[a-z0-9]{12})|([0-9]{12}:imported-model\/[a-z0-9]{12})|([0-9]{12}:application-inference-profile\/[a-z0-9]{12})|([0-9]{12}:inference-profile\/(([a-z-]{2,8}.)[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63})))|([0-9]{12}:default-prompt-router\/[a-zA-Z0-9-:.]+)))|(([a-z]{2}[.]{1})([a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63})))|([a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|arn:aws(-[^:]+)?:sagemaker:[a-z0-9-]{1,20}:[0-9]{12}:endpoint\/[a-z0-9-]{1,63}$/;
    
    const isValid = value === '' || modelIdRegex.test(value);
    return isValid;
  };  
  
  const handleBlur = () => {
    const isValid = validateModelId(modelId);
    setIsModelIdValid(isValid);
    if (!isValid) {
        setShouldShake(true);
        setTimeout(() => {
            setShouldShake(false);
        }, 500);
    }
  };

  const handleKBRefresh = async () => {
    setRefreshStatus({
      isLoading: true,
      message: 'Starting KB refresh...',
      error: null
    });

    try {
      const credentials = await Auth.currentCredentials();
      
      const bedrockClient = new BedrockAgentClient({
        region: process.env.REACT_APP_AWS_REGION,
        credentials: Auth.essentialCredentials(credentials)
      });

      // Start ingestion for Documents KB
      const docsCommand = new StartIngestionJobCommand({
        knowledgeBaseId: process.env.REACT_APP_DOCUMENTS_KB_ID,
        dataSourceId: process.env.REACT_APP_DOCUMENTS_DS_ID
      });

      const [docsResponse] = await Promise.all([
        bedrockClient.send(docsCommand)
      ]);

      setRefreshStatus({
        isLoading: false,
        message: 'KB refresh started successfully!',
        error: null,
        details: {
          documents: docsResponse.ingestionJob.ingestionJobId
        }
      });

    } catch (error) {
      console.error('KB Refresh error:', error);
      setRefreshStatus({
        isLoading: false,
        message: '',
        error: `Failed to refresh KB: ${error.message}`
      });
    }
  };

  const handleStatusCheck = async () => {
    setStatusCheck({
      isLoading: true,
      message: 'Checking refresh status...',
      error: null,
      details: null
    });

    try {
      const credentials = await Auth.currentCredentials();
      
      const bedrockClient = new BedrockAgentClient({
        region: process.env.REACT_APP_AWS_REGION,
        credentials: Auth.essentialCredentials(credentials)
      });

      // Get status for Documents KB
      const docsCommand = new ListIngestionJobsCommand({
        knowledgeBaseId: process.env.REACT_APP_DOCUMENTS_KB_ID,
        dataSourceId: process.env.REACT_APP_DOCUMENTS_DS_ID,
        maxResults: 1
      });

      const [docsJobs] = await Promise.all([
        bedrockClient.send(docsCommand)
      ]);

      setStatusCheck({
        isLoading: false,
        message: 'Status retrieved successfully',
        error: null,
        details: {
          documents: docsJobs.ingestionJobSummaries[0] || null
        }
      });

    } catch (error) {
      console.error('Status Check error:', error);
      setStatusCheck({
        isLoading: false,
        message: '',
        error: `Failed to check status: ${error.message}`,
        details: null
      });
    }
  };

  const formatJobStatus = (job) => {
    if (!job) return 'No recent jobs found';
    
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return 'N/A';
      return new Date(timestamp).toLocaleString();
    };
  
    const formatStatistics = (stats) => {
      if (!stats) return 'No statistics available';
      return (
        <div className="statistics-details">
          <p><strong>Documents Scanned:</strong> {stats.numberOfDocumentsScanned || 0}</p>
          <p><strong>New Documents Indexed:</strong> {stats.numberOfNewDocumentsIndexed || 0}</p>
          <p><strong>Modified Documents Indexed:</strong> {stats.numberOfModifiedDocumentsIndexed || 0}</p>
          <p><strong>Documents Failed:</strong> {stats.numberOfDocumentsFailed || 0}</p>
          <p><strong>Documents Deleted:</strong> {stats.numberOfDocumentsDeleted || 0}</p>
          <p><strong>Metadata Documents Scanned:</strong> {stats.numberOfMetadataDocumentsScanned || 0}</p>
          <p><strong>Metadata Documents Modified:</strong> {stats.numberOfMetadataDocumentsModified || 0}</p>
        </div>
      );
    };
  
    return (
      <div className="job-status-details">
        <div className="status-section">
          <h5>Basic Information</h5>
          <p><strong>Status:</strong> <span className={`status-badge ${job.status.toLowerCase()}`}>{job.status}</span></p>
          <p><strong>Job ID:</strong> {job.ingestionJobId}</p>
          <p><strong>Knowledge Base ID:</strong> {job.knowledgeBaseId}</p>
          <p><strong>Data Source ID:</strong> {job.dataSourceId}</p>
          {job.description && <p><strong>Description:</strong> {job.description}</p>}
        </div>
  
        <div className="status-section">
          <h5>Timestamps</h5>
          <p><strong>Started At:</strong> {formatTimestamp(job.startedAt)}</p>
          <p><strong>Last Updated:</strong> {formatTimestamp(job.updatedAt)}</p>
        </div>
  
        <div className="status-section">
          <h5>Statistics</h5>
          {formatStatistics(job.statistics)}
        </div>
      </div>
    );
  };  

  const renderContentUploadTab = () => (
    <Container>
      <FileUploader />
    </Container>
  );

  const renderKBRefreshTab = () => (
    <Container>
      <SpaceBetween size="l">
        <div className="button-group">
          <div className="refresh-container">
            <p>Trigger a refresh of the knowledge base</p>
            <button 
              className="refresh-button"
              onClick={handleKBRefresh}
              disabled={refreshStatus.isLoading}
            >
              {refreshStatus.isLoading ? 'Refreshing...' : 'Refresh KB'}
            </button>

            {refreshStatus.message && (
              <div className="status-message success">
                <p>{refreshStatus.message}</p>
                {refreshStatus.details && (
                  <div className="job-ids">
                    <p>Documents Job ID: {refreshStatus.details.documents}</p>
                  </div>
                )}
              </div>
            )}

            {refreshStatus.error && (
              <div className="status-message error">
                {refreshStatus.error}
              </div>
            )}
          </div>

          <div className="status-check-container">
            <p>Check the status of recent refresh jobs</p>
            <button 
              className="status-check-button"
              onClick={handleStatusCheck}
              disabled={statusCheck.isLoading}
            >
              {statusCheck.isLoading ? 'Checking...' : 'Check Status'}
            </button>

            {statusCheck.message && !statusCheck.error && statusCheck.details && (
              <div className="status-message success">
                <h4>Documents KB Status:</h4>
                {formatJobStatus(statusCheck.details.documents)}
              </div>
            )}

            {statusCheck.error && (
              <div className="status-message error">
                {statusCheck.error}
              </div>
            )}
          </div>
        </div>
      </SpaceBetween>
    </Container>
  );

  const renderGuardrailTab = () => (
    <Container>
      <SpaceBetween size="l">
        <div className="guardrail-container">
          <FormField
            label="Guardrail ID and Version"
            description="Provide the ID, Version for your Guardrail configuration. Guardrails will be disabled if these field are empty."
          >
            <Input
              value={guardrailValue}
              onChange={({ detail }) => setGuardrailValue(detail.value)}
              placeholder="Guardrail ID"
              type="text"
              multiline
            />
            <Input
                value={guardrailVersion}
                onChange={({ detail }) => setGuardrailVersion(detail.value)}
                placeholder="Guardrail Version"
                type="text"
            />
          </FormField>
        </div>
      </SpaceBetween>
    </Container>
  );
  
  const renderInferenceTab = () => (
    <Container>
      <SpaceBetween size="l">
        <div className="inference-container">
          <SpaceBetween size="m">
            <div className={`form-field-container ${shouldShake ? 'shake' : ''}`}>
              <FormField
                label="Model ID"
                description="Enter the Bedrock model inference profile ID"
                constraintText="Must be a valid model inference profile ID"
                errorText={!isModelIdValid ? "Invalid model inference profile ID" : undefined}
              >
                <Input
                  value={modelId}
                  onChange={({ detail }) => setModelId(detail.value)}
                  onBlur={handleBlur}
                  placeholder="us.amazon.nova-experimental-v100:100"
                  type="text"
                  invalid={!isModelIdValid}
                />
              </FormField>
            </div>  
            <FormField
              label="Temperature"
              description="Value between 0 and 1"
              constraintText="Enter a number between 0 and 1"
            >
              <Input
                value={temperature}
                onChange={({ detail }) => validateNumber(detail.value, setTemperature)}
                placeholder="0.7"
                type="number"
                step="0.1"
                min="0"
                max="1"
              />
            </FormField>
            <FormField
              label="Top P"
              description="Value between 0 and 1"
              constraintText="Enter a number between 0 and 1"
            >
              <Input
                value={topP}
                onChange={({ detail }) => validateNumber(detail.value, setTopP)}
                placeholder="0.9"
                type="number"
                step="0.1"
                min="0"
                max="1"
              />
            </FormField>
          </SpaceBetween>
        </div>
      </SpaceBetween>
    </Container>
  );

  return (
    <>
      <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <SpaceBetween size="l">
            <Select
              selectedOption={selectedOption}
              onChange={({ detail }) => setSelectedOption(detail.selectedOption)}
              options={options}
              placeholder="Select an operation"
            />
            {selectedOption.value === 'upload' 
              ? renderContentUploadTab()
              : selectedOption.value === 'refresh'
              ? renderKBRefreshTab()
              : selectedOption.value === 'guardrail'
              ? renderGuardrailTab()
              : renderInferenceTab()
            }
          </SpaceBetween>
        </div>
      </div>
      <Button
        variant="icon"
        iconName={isCollapsed ? "angle-right" : "angle-left"}
        onClick={onToggleCollapse}
        className="sidebar-toggle"
      />
    </>
  );
};

export default Sidebar;