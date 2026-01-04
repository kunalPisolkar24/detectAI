"use server"

export async function extractTextFromFile(formData: FormData) {
    try {
        const response = await fetch("http://localhost:8000/extract", {
            method: "POST",
            body: formData,
        })

        if (!response.ok) {
            if (response.status === 400) return { error: "Invalid file signature." }
            if (response.status === 413) return { error: "File exceeds maximum allowed size." }
            if (response.status === 415) return { error: "Unsupported file type. Use PDF, DOCX, or TXT." }
            if (response.status === 422) return { error: "File is corrupt or unreadable." }
            return { error: "Failed to extract text from file." }
        }

        const data = await response.json()

        if (!data.text) {
            return { error: "No text content found in file." }
        }

        return { success: true, text: data.text }
    } catch (error) {
        console.error("File extraction error:", error)
        return { error: "Service unavailable. Please try again later." }
    }
}
