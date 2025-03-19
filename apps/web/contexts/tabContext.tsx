import React, { createContext, useContext, useState, Dispatch, SetStateAction } from "react";

interface TabContextType {
  tab: string;
  setTab: Dispatch<SetStateAction<string>>;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider = ({ children }: { children: React.ReactNode }) => {
  const [tab, setTab] = useState("sequential");
  return <TabContext.Provider value={{ tab, setTab }}>{children}</TabContext.Provider>;
};

export const useTab = () => {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }
  return context;
};
