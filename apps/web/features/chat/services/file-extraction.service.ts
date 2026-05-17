import { env } from "@/lib/config/env"

export class FileExtractionService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async extract(formData: FormData): Promise<string> {
    const response = await fetch(`${this.baseUrl}/extract`, {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      this.handleError(response.status)
    }

    const data = await response.json()

    if (!data.text) {
      throw new Error("No text content found in file.")
    }

    return data.text
  }

  private handleError(status: number): never {
    switch (status) {
      case 400:
        throw new Error("Invalid file signature.")
      case 413:
        throw new Error("File exceeds maximum allowed size.")
      case 415:
        throw new Error("Unsupported file type. Use PDF, DOCX, or TXT.")
      case 422:
        throw new Error("File is corrupt or unreadable.")
      default:
        throw new Error("Failed to extract text from file.")
    }
  }
}

export const fileExtractionService = new FileExtractionService(env.FILE_EXTRACTOR_API_URL)