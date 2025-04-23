import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';

import { TabProvider, useTab } from './tabContext';

const TestComponent = () => {
  const { tab, setTab } = useTab();
  return (
    <div>
      <span data-testid="tab-value">{tab}</span>
      <button onClick={() => setTab('bert')}>Change to BERT</button>
      <button onClick={() => setTab('sequential')}>Change to Sequential</button>
    </div>
  );
};

describe('TabContext', () => {
  it('should throw an error when useTab is used outside of TabProvider', () => {
    const originalError = console.error;
    console.error = vi.fn();

    expect(() => render(<TestComponent />)).toThrow(
      'useTab must be used within a TabProvider'
    );

    console.error = originalError;
  });

  it('should provide the initial tab value "sequential"', () => {
    render(
      <TabProvider>
        <TestComponent />
      </TabProvider>
    );

    expect(screen.getByTestId('tab-value')).toHaveTextContent('sequential');
  });

  it('should update the tab value when setTab is called', async () => {
    render(
      <TabProvider>
        <TestComponent />
      </TabProvider>
    );

    expect(screen.getByTestId('tab-value')).toHaveTextContent('sequential');

    const changeButton = screen.getByRole('button', { name: 'Change to BERT' });

    await act(async () => {
      fireEvent.click(changeButton);
    });

    expect(screen.getByTestId('tab-value')).toHaveTextContent('bert');

    const resetButton = screen.getByRole('button', { name: 'Change to Sequential' });

     await act(async () => {
      fireEvent.click(resetButton);
    });

     expect(screen.getByTestId('tab-value')).toHaveTextContent('sequential');
  });

  it('should provide a stable setTab function', () => {
     let firstSetTab: Function | null = null;
     let secondSetTab: Function | null = null;

     const CaptureSetTabComponent = () => {
         const { setTab } = useTab();
         if (!firstSetTab) {
             firstSetTab = setTab;
         } else {
             secondSetTab = setTab;
         }
         return null;
     }

     const { rerender } = render(
         <TabProvider>
             <CaptureSetTabComponent />
         </TabProvider>
     );

     rerender(
         <TabProvider>
             <CaptureSetTabComponent />
         </TabProvider>
     );

     expect(firstSetTab).toBeDefined();
     expect(secondSetTab).toBeDefined();
     expect(firstSetTab).toBe(secondSetTab);
  });
});