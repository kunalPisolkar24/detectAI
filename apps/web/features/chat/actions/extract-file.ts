"use server"

import { fileExtractionService } from "../services/file-extraction.service"

type ExtractFileState = {
  success?: boolean
  text?: string
  error?: string
}

export async function extractTextFromFile(formData: FormData): Promise<ExtractFileState> {
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