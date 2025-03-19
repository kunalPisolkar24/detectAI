import React from "react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";
import { Button } from "@workspace/ui/components/button";
import { ChevronDown } from "lucide-react";
import { useTab } from "@/contexts/tabContext";

const ChangeModel = () => {
  const { tab, setTab } = useTab();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-[150px] text-left flex items-center justify-end">
          {tab === "sequential" ? "Sequential" : "BERT"}
          <ChevronDown className="ml-5 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-50">
        <DropdownMenuItem className={tab === "sequential" ? "bg-muted" : ""} onClick={() => setTab("sequential")}>
          Sequential
        </DropdownMenuItem>
        <DropdownMenuItem className={tab === "bert" ? "bg-muted" : ""} onClick={() => setTab("bert")}>
          BERT
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ChangeModel;
