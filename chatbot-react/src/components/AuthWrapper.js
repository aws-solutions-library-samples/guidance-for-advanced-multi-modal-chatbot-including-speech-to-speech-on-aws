import React, { useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import Chat from './Chat-edge';
import Sidebar from './Sidebar';

const AuthWrapper = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="app-container">
          <Sidebar 
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
          <div className={`main-content ${isSidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="header">
              <h1>Chat Assistant</h1>
              <button onClick={signOut}>Sign Out</button>
            </div>
            <Chat />
          </div>
        </div>
      )}
    </Authenticator>
  );
};

export default AuthWrapper;