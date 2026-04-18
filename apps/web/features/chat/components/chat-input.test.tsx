import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { ChatInput } from './chat-input'
import { useChatUIStore } from '../stores/ui-store'
import { useSendMessage } from '../hooks/use-chat-mutation'
import { useChatHistory } from '../hooks/use-chat-history'
import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { extractTextFromFile } from '../actions/extract-file'
import { LIVE_ANALYSIS_WARNING_CHARS, MAX_LIVE_ANALYSIS_CHARS, MIN_ANALYSIS_WORDS } from '../constants'

// Mock dependencies
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}))

vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return {
    ...actual,
    useSession: vi.fn(),
  }
})

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../stores/ui-store', () => ({
  useChatUIStore: vi.fn(),
}))

vi.mock('../hooks/use-chat-mutation', () => ({
  useSendMessage: vi.fn(),
}))

vi.mock('../hooks/use-chat-history', () => ({
  useChatHistory: vi.fn(),
}))

vi.mock('../actions/extract-file', () => ({
  extractTextFromFile: vi.fn(),
}))

vi.mock('@/lib/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
  inter: { className: 'inter' },
}))

// Mock framer-motion to avoid JSDOM issues
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    m: {
      div: ({ children, className, whileHover, whileTap, initial, animate, exit, transition, ...props }: any) => (
        <div className={className} {...props}>
          {children}
        </div>
      ),
    },
  }
})

// Setup common mock functions
const mockRouterPush = vi.fn()
const mockSendMessage = vi.fn()
const mockCancelAnalysis = vi.fn()
const mockSetModel = vi.fn()
const mockSetCurrentChatId = vi.fn()

const defaultStore = {
  selectedModel: 'spark',
  setModel: mockSetModel,
  isRateLimited: false,
  currentChatId: 'chat-1',
  setCurrentChatId: mockSetCurrentChatId,
}

const defaultMutation = {
  sendMessage: mockSendMessage,
  cancelActiveAnalysis: mockCancelAnalysis,
  isAnalyzing: false,
  isCancelling: false,
  activeAnalysisChatId: null,
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(useRouter).mockReturnValue({ push: mockRouterPush } as any)
  vi.mocked(usePathname).mockReturnValue('/chat')
  
  vi.mocked(useSession).mockReturnValue({
    data: { user: { isPremium: true } },
    status: 'authenticated',
  } as any)

  vi.mocked(useChatUIStore).mockReturnValue(defaultStore as any)
  vi.mocked(useSendMessage).mockReturnValue(defaultMutation as any)
  vi.mocked(useChatHistory).mockReturnValue({ data: [] } as any)
})

describe('ChatInput', () => {
  describe('Initial State & Accessibility', () => {
    it('renders the input field correctly', () => {
      render(<ChatInput />)
      expect(screen.getByPlaceholderText(/paste your text here/i)).toBeInTheDocument()
      expect(screen.getByText(`0 / ${MAX_LIVE_ANALYSIS_CHARS.toLocaleString()}`)).toBeInTheDocument()
    })

    it('has no basic accessibility violations', async () => {
      const { container } = render(<ChatInput />)
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })
  })

  describe('Text Entry & Submission', () => {
    it('calls sendMessage on valid text submission via button', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      const input = screen.getByPlaceholderText(/paste your text here/i)
      const submitBtn = screen.getByRole('button', { name: /analyze text/i })
      
      // Minimum 100 words required
      const validText = ("word " + "a ").repeat(50) + "word" // 101 words
      await user.type(input, validText)
      await user.click(submitBtn)
      
      expect(mockSendMessage).toHaveBeenCalledWith(validText)
    })

    it('calls sendMessage on valid text submission via Enter key', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      const input = screen.getByPlaceholderText(/paste your text here/i)
      const validText = ("word " + "a ").repeat(50) + "word" // 101 words
      
      await user.type(input, validText)
      await user.keyboard('{Enter}')
      
      expect(mockSendMessage).toHaveBeenCalledWith(validText)
    })
  })

  describe('Validation (Toasts)', () => {
    it('shows error toast when text is under minimum words', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      const input = screen.getByPlaceholderText(/paste your text here/i)
      await user.type(input, 'This is only nine words long, so it fails.')
      await user.keyboard('{Enter}')
      
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(`at least ${MIN_ANALYSIS_WORDS} words`))
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('shows error toast when text exceeds max characters limit', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      const input = screen.getByPlaceholderText(/paste your text here/i)
      const longText = 'a'.repeat(MAX_LIVE_ANALYSIS_CHARS + 1)
      
      // Paste to bypass typing speed
      await user.click(input)
      await user.paste(longText)
      await user.keyboard('{Enter}')
      
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('exceeds'))
      expect(mockSendMessage).not.toHaveBeenCalled()
    })
  })

  describe('Model Selection (Dropdown)', () => {
    // Note: Radix dropdowns can be tricky. We use userEvent.
    it('renders selected model and opens dropdown', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      const trigger = screen.getByRole('button', { name: /select model/i })
      expect(trigger).toHaveTextContent('spark')
      
      await user.click(trigger)
      
      // Dropdown content should appear
      expect(screen.getByRole('menuitem', { name: /Spark/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /Flare/i })).toBeInTheDocument()
    })

    it('disables Flare model for free users and prompts upgrade', async () => {
      vi.mocked(useSession).mockReturnValue({
        data: { user: { isPremium: false } },
        status: 'authenticated',
      } as any)
      
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      const trigger = screen.getByRole('button', { name: /select model/i })
      await user.click(trigger)
      
      const flareItem = screen.getByRole('menuitem', { name: /Flare/i })
      expect(flareItem).toHaveTextContent('Upgrade')
      
      await user.click(flareItem)
      expect(mockRouterPush).toHaveBeenCalledWith('/upgrade')
      expect(mockSetModel).not.toHaveBeenCalled()
    })
  })

  describe('Premium/Rate Limit Logic', () => {
    it('shows upgrade banner when rate limited as a free user', () => {
      vi.mocked(useSession).mockReturnValue({
        data: { user: { isPremium: false } },
        status: 'authenticated',
      } as any)
      vi.mocked(useChatUIStore).mockReturnValue({
        ...defaultStore,
        isRateLimited: true,
      } as any)
      
      render(<ChatInput />)
      
      expect(screen.getByText(/usage limit reached/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /upgrade now/i })).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/paste your text here/i)).toBeDisabled()
    })
  })

  describe('Analysis States', () => {
    it('shows STOP button and disables input when current chat is analyzing', async () => {
      vi.mocked(useSendMessage).mockReturnValue({
        ...defaultMutation,
        isAnalyzing: true,
        activeAnalysisChatId: 'chat-1',
      } as any)
      
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<ChatInput />)
      
      expect(screen.getByPlaceholderText(/paste your text here/i)).toBeDisabled()
      
      const stopBtn = screen.getByRole('button', { name: /cancel analysis/i })
      expect(stopBtn).toHaveTextContent('STOP')
      
      await user.click(stopBtn)
      expect(mockCancelAnalysis).toHaveBeenCalled()
    })

    it('shows WAIT/OPEN banner when another chat is analyzing', async () => {
      vi.mocked(useSendMessage).mockReturnValue({
        ...defaultMutation,
        isAnalyzing: true,
        activeAnalysisChatId: 'chat-2',
      } as any)
      vi.mocked(useChatHistory).mockReturnValue({
        data: [{ id: 'chat-2', title: 'Other Chat Title' }],
      } as any)
      
      render(<ChatInput />)
      
      expect(screen.getByText(/analysis is still running in "Other Chat Title"/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })
  })

  describe('File Upload', () => {
    it('handles successful file extraction', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(extractTextFromFile).mockResolvedValue({ text: 'Extracted content from file' })
      
      render(<ChatInput />)
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['dummy content'], 'test.txt', { type: 'text/plain' })
      
      await user.upload(fileInput, file)
      
      expect(extractTextFromFile).toHaveBeenCalled()
      
      await waitFor(() => {
        const input = screen.getByPlaceholderText(/paste your text here/i) as HTMLTextAreaElement
        expect(input.value).toBe('Extracted content from file')
      })
    })

    it('shows error toast if file is too large', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      
      render(<ChatInput />)
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      
      // Create a mock file with a large size property
      const file = new File([''], 'large.txt', { type: 'text/plain' })
      Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
      
      await user.upload(fileInput, file)
      
      expect(toast.error).toHaveBeenCalledWith('File size exceeds 10MB limit')
      expect(extractTextFromFile).not.toHaveBeenCalled()
    })
  })
})
