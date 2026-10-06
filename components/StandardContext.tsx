'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { StandardType } from '../lib/types';

interface StandardContextProps {
  standard: StandardType;
  setStandard: (std: StandardType) => void;
  toggleStandard: () => void;
}

const StandardContext = createContext<StandardContextProps>({
  standard: 'CN',
  setStandard: () => {},
  toggleStandard: () => {},
});

export const StandardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [standard, setStandardState] = useState<StandardType>('CN');

  useEffect(() => {
    const saved = localStorage.getItem('aqi_standard') as StandardType;
    if (saved === 'CN' || saved === 'US') {
      setStandardState(saved);
    }
  }, []);

  const setStandard = (std: StandardType) => {
    setStandardState(std);
    localStorage.setItem('aqi_standard', std);
  };

  const toggleStandard = () => {
    setStandard(standard === 'CN' ? 'US' : 'CN');
  };

  return (
    <StandardContext.Provider value={{ standard, setStandard, toggleStandard }}>
      {children}
    </StandardContext.Provider>
  );
};

export const useStandard = () => useContext(StandardContext);
