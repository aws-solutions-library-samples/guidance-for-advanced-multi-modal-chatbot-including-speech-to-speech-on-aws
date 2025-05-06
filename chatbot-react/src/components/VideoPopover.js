import React, { useState } from 'react';
import './VideoPopover.css';

const VideoPopover = ({ videoUrl, timestamp, displayTime }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Combine the video URL with the timestamp in seconds
  const fullVideoUrl = videoUrl ? `${videoUrl}#t=${timestamp}` : '';
  
  console.log('VideoPopover props:', { videoUrl, timestamp, displayTime }); // Debug log
  console.log('Full video URL:', fullVideoUrl); // Debug log

  return (
    <div className="video-popover-container">
      <button 
        className="timestamp-button"
        onClick={() => {
          console.log('Opening video with URL:', fullVideoUrl); // Debug log
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
