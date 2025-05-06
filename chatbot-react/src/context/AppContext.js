import React, { createContext, useState, useContext } from 'react';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [guardrailValue, setGuardrailValue] = useState('');
  const [guardrailVersion, setGuardrailVersion] = useState('');
  const [temperature, setTemperature] = useState('0.7');
  const [topP, setTopP] = useState('0.9');
  const [modelId, setModelId] = useState('');

  return (
    <AppContext.Provider value={{ 
      guardrailValue, 
      setGuardrailValue,
      guardrailVersion,
      setGuardrailVersion,
      temperature,
      setTemperature,
      topP,
      setTopP,
      modelId,
      setModelId
    }}>
      {children}
    </AppContext.Provider>
  );
};

// Guardrails Hook
export const useGuardrail = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useGuardrail must be used within an AppProvider');
  }
  return {
    guardrailValue: context.guardrailValue,
    setGuardrailValue: context.setGuardrailValue,
    guardrailVersion: context.guardrailVersion,
    setGuardrailVersion: context.setGuardrailVersion
  };
};

// Inference Hook
export const useInferenceConfig = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useInferenceConfig must be used within an AppProvider');
  }
  return {
    temperature: context.temperature,
    setTemperature: context.setTemperature,
    topP: context.topP,
    setTopP: context.setTopP,
    modelId: context.modelId,
    setModelId: context.setModelId
  };
};


// Generic hook to access all context values
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
