import * as React from "react";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Auth } from 'aws-amplify';
import './FileUploader.css';

const BUCKET_NAME = process.env.REACT_APP_S3_SOURCE;

const FileUploader = () => {
  const [value, setValue] = React.useState([]);
  const [uploadStatus, setUploadStatus] = React.useState([]);
  const [uploadProgress, setUploadProgress] = React.useState({});
  const [isUploading, setIsUploading] = React.useState(false);

  const sanitizeFileName = (fileName) => {
    return fileName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-_.]/g, '')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const handleFileChange = ({ detail }) => {
    console.log('File change detail:', detail);
    
    const newFiles = detail.value.filter(newFile => 
      !value.some(existingFile => existingFile.name === newFile.name)
    );
    
    setValue(detail.value);

    if (newFiles.length > 0) {
      const validFiles = newFiles.filter(item => item instanceof File);
      if (validFiles.length > 0) {
        handleUpload(validFiles);
      }
    }
  };

  const uploadFile = async (file, s3Client) => {
    if (!(file instanceof File)) {
      throw new Error('Invalid file object');
    }

    const fileExt = file.name.split('.').pop().toLowerCase();
    const nameWithoutExt = file.name.slice(0, -(fileExt.length + 1));
    const sanitizedFileName = `${sanitizeFileName(nameWithoutExt)}.${fileExt}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: sanitizedFileName,
      ContentType: file.type || 'application/octet-stream',
      ContentLength: file.size,
    });

    try {
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percentCompleted = Math.round((event.loaded * 100) / event.total);
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: percentCompleted
            }));
            
            setUploadStatus(prev => prev.map(status => 
              status.name === file.name 
                ? { ...status, message: `⏳ Uploading: ${percentCompleted}%` }
                : status
            ));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve({ 
              Key: sanitizedFileName,
              Location: signedUrl.split('?')[0]
            });
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      });
    } catch (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  };

  const handleUpload = async (files) => {
    if (!BUCKET_NAME) {
      console.error('S3 bucket name is not configured');
      return;
    }

    setIsUploading(true);

    // Filter out any non-File objects
    const validFiles = files.filter(file => file instanceof File);

    setUploadStatus(prev => [
      ...prev,
      ...validFiles.map(file => ({
        name: file.name,
        status: 'queued',
        message: '⏳ Waiting in queue...'
      }))
    ]);

    try {
      const credentials = await Auth.currentCredentials();
      
      const s3Client = new S3Client({
        region: process.env.REACT_APP_AWS_REGION,
        credentials: Auth.essentialCredentials(credentials)
      });

      for (const file of validFiles) {
        try {
          setUploadStatus(prev => prev.map(status => 
            status.name === file.name 
              ? { ...status, status: 'processing', message: '⚙️ Processing...' }
              : status
          ));

          const result = await uploadFile(file, s3Client);
          
          setUploadStatus(prev => prev.map(status => 
            status.name === file.name 
              ? {
                  name: file.name,
                  sanitizedName: result.Key,
                  status: 'success',
                  message: `✅ Successfully uploaded as ${result.Key}`
                }
              : status
          ));

        } catch (error) {
          console.error(`Upload error for ${file.name}:`, error);
          setUploadStatus(prev => prev.map(status => 
            status.name === file.name 
              ? {
                  name: file.name,
                  status: 'error',
                  message: `❌ Failed to upload: ${error.message}`
                }
              : status
          ));

          setValue(prev => 
            prev.map(item => 
              item.name === file.name 
                ? { ...item, status: "error", errorText: error.message }
                : item
            )
          );
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
    }
  };

  return (
    <FormField
      label="Upload Files"
      description="Select files to upload to S3"
    >
      <FileUpload
        onChange={handleFileChange}
        value={value}
        i18nStrings={{
          uploadButtonText: e => e ? "Choose files" : "Choose file",
          dropzoneText: e => e ? "Drop files to upload" : "Drop file to upload",
          removeFileAriaLabel: e => `Remove file ${e + 1}`,
          limitShowFewer: "Show fewer files",
          limitShowMore: "Show more files",
          errorIconAriaLabel: "Error",
          warningIconAriaLabel: "Warning"
        }}
        multiple
        showFileLastModified
        showFileSize
        showFileThumbnail
        tokenLimit={3}
        constraintText="Maximum 3 files can be uploaded at once"
        loading={isUploading}
      />

      {uploadStatus.length > 0 && (
        <div className="upload-status-list">
          {uploadStatus.map((status, index) => (
            <div 
              key={index} 
              className={`upload-status-item ${status.status}`}
            >
              <div className="file-name">{status.name}</div>
              <div className="status-message">{status.message}</div>
              {uploadProgress[status.name] !== undefined && (
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar" 
                    style={{width: `${uploadProgress[status.name]}%`}}
                  />
                  <span className="progress-text">
                    {uploadProgress[status.name]}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </FormField>
  );
};

export default FileUploader;
