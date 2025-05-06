import React, { useState } from 'react';
import { Auth } from 'aws-amplify';
import { BedrockAgentClient, 
        StartIngestionJobCommand, 
        ListIngestionJobsCommand 
} from "@aws-sdk/client-bedrock-agent";
import { Upload } from "@aws-sdk/lib-storage";
import './Sidebar.css';
import { 
  S3Client, 
  CreateMultipartUploadCommand, 
  UploadPartCommand, 
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand 
} from "@aws-sdk/client-s3";


const Sidebar = ({ isCollapsed, onToggleCollapse }) => {
  const [activeTab, setActiveTab] = useState('upload');
  const [uploadStatus, setUploadStatus] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
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

  const BUCKET_NAME = process.env.REACT_APP_S3_SOURCE;
  
  const sanitizeFileName = (fileName) => {
    return fileName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-_.]/g, '')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };
  
  const handleFileUpload = async (event) => {
      const files = Array.from(event.target.files);
      setIsUploading(true);
  
      // Add queue status
      setUploadStatus(prev => [
        ...prev,
        ...files.map(file => ({
          name: file.name,
          status: 'queued',
          message: '⏳ Waiting in queue...'
        }))
      ]);
  
      try {
        const credentials = await Auth.currentCredentials();
        
        const s3Client = new S3Client({
          region: process.env.REACT_APP_AWS_REGION,
          credentials: Auth.essentialCredentials(credentials),
          signatureVersion: 'v4',
          useAccelerateEndpoint: false,
          forcePathStyle: true,
          endpoint: `https://s3.${process.env.REACT_APP_AWS_REGION}.amazonaws.com`
        });
  
        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
          const file = files[fileIndex];
          
          try {
            // Update status to show which file is currently being processed
            setUploadStatus(prev => prev.map(status => 
              status.name === file.name 
                ? { ...status, status: 'processing', message: '⚙️ Processing...' }
                : status
            ));
  
            // Get file extension
            const fileExt = file.name.split('.').pop().toLowerCase();
            // Get file name without extension
            const nameWithoutExt = file.name.slice(0, -(fileExt.length + 1));
            // Create sanitized filename
            const sanitizedFileName = `${sanitizeFileName(nameWithoutExt)}.${fileExt}`;
  
            console.log(`Processing file ${fileIndex + 1}/${files.length}`);
            console.log(`Original filename: ${file.name}`);
            console.log(`Sanitized filename: ${sanitizedFileName}`);
  
            const partSize = 1024 * 1024 * 5; // 5MB parts
            
            // For smaller files, use direct upload
            if (file.size <= partSize) {
              console.log(`Using direct upload for ${sanitizedFileName}`);
              const upload = new Upload({
                client: s3Client,
                params: {
                  Bucket: BUCKET_NAME,
                  Key: sanitizedFileName,
                  Body: file,
                  ContentType: file.type,
                  ACL: 'private'
                },
                queueSize: 1
              });
  
              upload.on("httpUploadProgress", (progress) => {
                const percentCompleted = Math.round((progress.loaded * 100) / progress.total);
                setUploadProgress(prev => ({
                  ...prev,
                  [file.name]: percentCompleted
                }));
                
                // Update status message with progress
                setUploadStatus(prev => prev.map(status => 
                  status.name === file.name 
                    ? { ...status, message: `⏳ Uploading: ${percentCompleted}%` }
                    : status
                ));
              });
  
              const result = await upload.done();
              console.log('Upload result:', result);
            } else {
              // For larger files, use multipart upload with part tracking
              console.log(`Using multipart upload for ${sanitizedFileName}`);
              
              const parts = [];
              let uploadId;
  
              try {
                // Create multipart upload
                const createMultipartUpload = await s3Client.send(new CreateMultipartUploadCommand({
                  Bucket: BUCKET_NAME,
                  Key: sanitizedFileName,
                  ContentType: file.type,
                  ACL: 'private'
                }));
  
                uploadId = createMultipartUpload.UploadId;
                console.log('Created multipart upload:', uploadId);
  
                // Upload parts
                const numberOfParts = Math.ceil(file.size / partSize);
                
                for (let i = 0; i < numberOfParts; i++) {
                  const start = i * partSize;
                  const end = Math.min(start + partSize, file.size);
                  const chunk = file.slice(start, end);
  
                  // Convert chunk to Uint8Array
                  const arrayBuffer = await chunk.arrayBuffer();
                  const uint8Array = new Uint8Array(arrayBuffer);
  
                  console.log(`Uploading part ${i + 1}/${numberOfParts}`);
  
                  const uploadPartCommand = new UploadPartCommand({
                    Bucket: BUCKET_NAME,
                    Key: sanitizedFileName,
                    UploadId: uploadId,
                    PartNumber: i + 1,
                    Body: uint8Array,
                    ContentLength: uint8Array.length,
                    ChecksumAlgorithm: "CRC32"
                  });
  
                  const uploadPartResult = await s3Client.send(uploadPartCommand);
                  
                  parts.push({
                    PartNumber: i + 1,
                    ETag: uploadPartResult.ETag,
                    ChecksumCRC32: uploadPartResult.ChecksumCRC32
                  });
  
                  // Update progress
                  const percentCompleted = Math.round(((i + 1) / numberOfParts) * 100);
                  setUploadProgress(prev => ({
                    ...prev,
                    [file.name]: percentCompleted
                  }));
  
                  // Update status message with progress
                  setUploadStatus(prev => prev.map(status => 
                    status.name === file.name 
                      ? { ...status, message: `⏳ Uploading part ${i + 1}/${numberOfParts} (${percentCompleted}%)` }
                      : status
                  ));
                }
  
                // Complete multipart upload
                console.log('Completing multipart upload with parts:', parts);
                const completeMultipartUpload = await s3Client.send(new CompleteMultipartUploadCommand({
                  Bucket: BUCKET_NAME,
                  Key: sanitizedFileName,
                  UploadId: uploadId,
                  MultipartUpload: {
                    Parts: parts
                  }
                }));
  
                console.log('Upload complete:', completeMultipartUpload);
  
              } catch (error) {
                if (uploadId) {
                  await s3Client.send(new AbortMultipartUploadCommand({
                    Bucket: BUCKET_NAME,
                    Key: sanitizedFileName,
                    UploadId: uploadId
                  }));
                }
                throw error;
              }
            }
            
            // Update final status
            setUploadStatus(prev => prev.map(status => 
              status.name === file.name 
                ? {
                    name: file.name,
                    sanitizedName: sanitizedFileName,
                    status: 'success',
                    message: `✅ Successfully uploaded as ${sanitizedFileName}`
                  }
                : status
            ));
  
          } catch (error) {
            console.error('Upload error:', error);
            setUploadStatus(prev => prev.map(status => 
              status.name === file.name 
                ? {
                    name: file.name,
                    status: 'error',
                    message: `❌ Failed to upload ${file.name}: ${error.message}`
                  }
                : status
            ));
          } finally {
            setUploadProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[file.name];
              return newProgress;
            });
          }
        }
      } catch (error) {
        console.error('Credentials error:', error);
        setUploadStatus(prev => [...prev, {
          name: 'Authentication',
          status: 'error',
          message: `❌ Authentication failed: ${error.message}`
        }]);
      } finally {
        setIsUploading(false);
        event.target.value = '';
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
    <div className="upload-section">
      <input
        type="file"
        onChange={handleFileUpload}
        multiple
        disabled={isUploading}
        className="file-input"
      />
      {isUploading && <div className="upload-progress">Uploading...</div>}
      
      {Object.entries(uploadProgress).map(([fileName, progress]) => (
        <div key={fileName} className="progress-bar-container">
          <div>{fileName}</div>
          <div className="progress-bar">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <div>{progress}%</div>
        </div>
      ))}

      {uploadStatus.length > 0 && (
        <div className="upload-history">
          <h3>Upload History</h3>
          <ul>
            {uploadStatus.map((status, index) => (
              <div key={index} className={`upload-status ${status.status}`}>
                <div className="file-name">{status.name}</div>
                <div className="status-message">{status.message}</div>
                {uploadProgress[status.name] !== undefined && (
                  <div className="progress-bar">
                    <div 
                      className="progress" 
                      style={{width: `${uploadProgress[status.name]}%`}}
                    />
                  </div>
                )}
              </div>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const renderKBRefreshTab = () => (
    <div className="kb-refresh-section">
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
                  <p>Transcript Job ID: {refreshStatus.details.transcripts}</p>
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
              <h4>Transcripts KB Status:</h4>
              {formatJobStatus(statusCheck.details.transcripts)}
              
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
    </div>
  );

  return (
    <>
      <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <div className="tabs">
            <button 
              className={`tab ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              Content Upload
            </button>
            <button 
              className={`tab ${activeTab === 'refresh' ? 'active' : ''}`}
              onClick={() => setActiveTab('refresh')}
            >
              KB Refresh
            </button>
          </div>

          {activeTab === 'upload' ? renderContentUploadTab() : renderKBRefreshTab()}
        </div>
      </div>
      <button 
        className="sidebar-toggle"
        onClick={onToggleCollapse}
      >
        {isCollapsed ? '→' : '←'}
      </button>
    </>
  );
};

export default Sidebar;