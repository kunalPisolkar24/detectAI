import { PRICING_TEXT, type BillingCycle } from "../../constants";
import { SegmentedControl } from "./segmented-control";

interface BillingToggleProps {
  value: BillingCycle;
  onChange: (value: BillingCycle) => void;
}

export function BillingToggle({ value, onChange }: BillingToggleProps) {
  return (
    <SegmentedControl<BillingCycle>
      value={value}
      onChange={onChange}
      options={[
        { value: "monthly", label: "Monthly" },
        { value: "yearly", label: "Yearly", badge: PRICING_TEXT.yearlySavings },
      ]}
    />
  );
}
