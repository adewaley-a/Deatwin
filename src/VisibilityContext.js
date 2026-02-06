import React, { createContext, useState } from 'react';

// Create a context to hold visibility state
export const VisibilityContext = createContext();

export const VisibilityProvider = ({ children }) => {
  const [isComponentVisible, setIsComponentVisible] = useState(false);

  // Function to toggle visibility
  const toggleVisibility = () => {
    setIsComponentVisible(!isComponentVisible);
  };

  const resetVisibility = () => {
    setIsComponentVisible(false)
  }

  return (
    <VisibilityContext.Provider value={{ isComponentVisible, toggleVisibility, resetVisibility}}>
      {children}
    </VisibilityContext.Provider>
  );
};
