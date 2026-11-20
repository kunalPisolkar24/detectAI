"use server"

import { fileExtractionService } from "../services/file-extraction.service"
import { DOCUMENT_PARSER_UNAVAILABLE_TOOLTIP, isPreviewMode } from "@/lib/config/preview"

type ExtractFileState = {
  success?: boolean
  text?: string
  error?: string
}

export async function extractTextFromFile(formData: FormData): Promise<ExtractFileState> {
  if (isPreviewMode()) {
    return { error: "Document parsing is not available in preview mode" }
  }
  try {
    const text = await fileExtractionService.extract(formData)

    return { success: true, text }
  } catch (error) {
    console.error("File extraction error:", error)

    const raw = error instanceof Error ? error.message : ""
    // Align toast with the disabled-button tooltip when the parser is unreachable.
    const isUnreachable =
      !raw ||
      /fetch failed|ECONNREFUSED|Failed to fetch|Service unavailable/i.test(raw)
    const errorMessage = isUnreachable
      ? DOCUMENT_PARSER_UNAVAILABLE_TOOLTIP
      : raw || "Service unavailable. Please try again later."

    return { error: errorMessage }
  }
}