"use server"

import { fileExtractionService } from "../services/file-extraction.service"

type ExtractFileState = {
  success?: boolean
  text?: string
  error?: string
}

export async function extractTextFromFile(formData: FormData): Promise<ExtractFileState> {
  if (process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
    return { error: "Document parsing is not available in preview mode" }
  }
  try {
    const text = await fileExtractionService.extract(formData)

    return { success: true, text }
  } catch (error) {
    console.error("File extraction error:", error)

    const errorMessage = error instanceof Error
      ? error.message
      : "Service unavailable. Please try again later."

    return { error: errorMessage }
  }
}