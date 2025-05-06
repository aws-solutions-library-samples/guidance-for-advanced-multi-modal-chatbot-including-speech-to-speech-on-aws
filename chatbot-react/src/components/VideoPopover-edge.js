import React, { useState, useEffect } from 'react';
import './VideoPopover.css';

const VideoPopover = ({ videoUrl, timestamp, displayTime, authToken }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Combine the video URL with the timestamp in seconds
  const fullVideoUrl = videoUrl ? `${videoUrl}#t=${timestamp}` : '';
  
  useEffect(() => {
    let originalFetch;
    
    if (isOpen && videoUrl) {
      // Store original fetch
      originalFetch = window.fetch;
      
      // Set up interceptor
      window.fetch = (...args) => {
        if (args[0].includes(videoUrl)) {
          const [resource, config] = args;
          console.log('Intercepting video request, adding auth token');
          return originalFetch(resource, {
            ...config,
            headers: {
              ...config?.headers,
              'Authorization': `Bearer ${authToken}`
            }
          });
        }
        return originalFetch(...args);
      };
    }

    // Cleanup function
    return () => {
      if (originalFetch) {
        console.log('Cleaning up fetch interceptor');
        window.fetch = originalFetch;
      }
    };
  }, [isOpen, videoUrl, authToken]); // Dependencies

  return (
    <div className="video-popover-container">
      <button 
        className="timestamp-button"
        onClick={() => {
          console.log('Opening video with URL:', fullVideoUrl);
          setIsOpen(!isOpen);
        }}
      >
        {displayTime}
      </button>
      
      {isOpen && (
        <div className="video-popover">
          <div className="video-popover-content">
            <button 
              className="close-button"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
            <video
              controls
              autoPlay
              crossOrigin="anonymous"
              src={fullVideoUrl}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPopover;
