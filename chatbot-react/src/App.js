import React from 'react';
import AuthWrapper from './components/AuthWrapper';
import './App.css';
import '@aws-amplify/ui-react/styles.css';
import '@cloudscape-design/global-styles/index.css';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { AppProvider } from './context/AppContext'; 

applyMode(Mode.Dark);

function App() {
  return (
    <AppProvider>
      <div className="App">
        <AuthWrapper />
      </div>
    </AppProvider>
  );
}

export default App;