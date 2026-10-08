'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { StandardType } from '../lib/types';

interface StandardContextProps {
  standard: StandardType;
  setStandard: (std: StandardType) => void;
  toggleStandard: () => void;
  mounted: boolean;
}

const StandardContext = createContext<StandardContextProps>({
  standard: 'CN',
  setStandard: () => {},
  toggleStandard: () => {},
  mounted: false,
});

export const StandardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [standard, setStandardState] = useState<StandardType>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = (localStorage.getItem('aqi_standard_v2') || localStorage.getItem('aqi_standard')) as StandardType;
        if (saved === 'CN' || saved === 'US') return saved;
      } catch (e) {}
    }
    return 'CN';
  });
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = (localStorage.getItem('aqi_standard_v2') || localStorage.getItem('aqi_standard')) as StandardType;
      if (saved === 'CN' || saved === 'US') {
        setStandardState(saved);
      }
    } catch (e) {}
    setMounted(true);
  }, []);

  const setStandard = (std: StandardType) => {
    setStandardState(std);
    try {
      localStorage.setItem('aqi_standard_v2', std);
      localStorage.setItem('aqi_standard', std);
    } catch (e) {}
  };

  const toggleStandard = () => {
    setStandard(standard === 'US' ? 'CN' : 'US');
  };

  return (
    <StandardContext.Provider value={{ standard, setStandard, toggleStandard, mounted }}>
      {children}
    </StandardContext.Provider>
  );
};

export const useStandard = () => useContext(StandardContext);
