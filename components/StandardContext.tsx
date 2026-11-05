'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { StandardType } from '../lib/types';

interface StandardContextProps {
  standard: StandardType;
  setStandard: (std: StandardType) => void;
  toggleStandard: () => void;
  onlyPm25: boolean;
  setOnlyPm25: (val: boolean) => void;
  toggleOnlyPm25: () => void;
  mounted: boolean;
}

const StandardContext = createContext<StandardContextProps>({
  standard: 'US',
  setStandard: () => {},
  toggleStandard: () => {},
  onlyPm25: true, // 默认开启只看 PM2.5
  setOnlyPm25: () => {},
  toggleOnlyPm25: () => {},
  mounted: false,
});

export const StandardProvider: React.FC<{
  children: React.ReactNode;
  initialStandard?: StandardType;
  initialOnlyPm25?: boolean;
}> = ({ children, initialStandard = 'US', initialOnlyPm25 = true }) => {
  const [standard, setStandardState] = useState<StandardType>(initialStandard);
  const [onlyPm25, setOnlyPm25State] = useState<boolean>(initialOnlyPm25);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    try {
      const savedStd = (localStorage.getItem('aqi_standard_v2') || localStorage.getItem('aqi_standard')) as StandardType;
      if (savedStd === 'CN' || savedStd === 'US') {
        if (savedStd !== standard) {
          setStandardState(savedStd);
        }
        document.cookie = `aqi_standard=${savedStd}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.setItem('aqi_standard_v2', initialStandard);
        document.cookie = `aqi_standard=${initialStandard}; path=/; max-age=31536000; SameSite=Lax`;
      }

      const savedOnlyPm25 = localStorage.getItem('aqi_only_pm25_v2');
      if (savedOnlyPm25 !== null) {
        setOnlyPm25State(savedOnlyPm25 === 'true');
      } else {
        // 默认开启只看 PM2.5
        setOnlyPm25State(true);
        localStorage.setItem('aqi_only_pm25', 'true');
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

  const setOnlyPm25 = (val: boolean) => {
    setOnlyPm25State(val);
    try {
      localStorage.setItem('aqi_only_pm25_v2', String(val));
      localStorage.setItem('aqi_only_pm25', String(val));
    } catch (e) {}
  };

  const toggleOnlyPm25 = () => {
    setOnlyPm25State((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('aqi_only_pm25_v2', String(next));
        localStorage.setItem('aqi_only_pm25', String(next));
      } catch (e) {}
      return next;
    });
  };

  return (
    <StandardContext.Provider
      value={{
        standard,
        setStandard,
        toggleStandard,
        onlyPm25,
        setOnlyPm25,
        toggleOnlyPm25,
        mounted,
      }}
    >
      {children}
    </StandardContext.Provider>
  );
};

export const useStandard = () => useContext(StandardContext);
