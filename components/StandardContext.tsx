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
  standard: 'US',
  setStandard: () => {},
  toggleStandard: () => {},
  mounted: false,
});

export const StandardProvider: React.FC<{
  children: React.ReactNode;
  initialStandard?: StandardType;
}> = ({ children, initialStandard = 'US' }) => {
  const [standard, setStandardState] = useState<StandardType>(initialStandard);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = (localStorage.getItem('aqi_standard_v2') || localStorage.getItem('aqi_standard')) as StandardType;
      if (saved === 'CN' || saved === 'US') {
        if (saved !== standard) {
          setStandardState(saved);
        }
        document.cookie = `aqi_standard=${saved}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.setItem('aqi_standard_v2', initialStandard);
        document.cookie = `aqi_standard=${initialStandard}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch (e) {}
    setMounted(true);
  }, []);

  const setStandard = (std: StandardType) => {
    setStandardState(std);
    try {
      localStorage.setItem('aqi_standard_v2', std);
      localStorage.setItem('aqi_standard', std);
      document.cookie = `aqi_standard=${std}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (e) {}
  };

  const toggleStandard = () => {
    const next = standard === 'US' ? 'CN' : 'US';
    setStandard(next);
  };

  return (
    <StandardContext.Provider value={{ standard, setStandard, toggleStandard, mounted }}>
      {children}
    </StandardContext.Provider>
  );
};

export const useStandard = () => useContext(StandardContext);
