"use server";

import { getUser } from "@/auth/server";
import { prisma } from "@/db/prisma";
import { handleError } from "@/lib/utils";
import genAI from "@/gemini";

export const createNoteAction = async (noteId: string) => {
  try {
    const user = await getUser();
    if (!user) throw new Error("You must be logged in to create a note");

    await prisma.note.create({
      data: {
        id: noteId,
        authorId: user.id,
        text: "",
      },
    });

    return { errorMessage: null };
  } catch (error) {
    return handleError(error);
  }
};

export const updateNoteAction = async (noteId: string, text: string) => {
  try {
    const user = await getUser();
    if (!user) throw new Error("You must be logged in to update a note");

    await prisma.note.update({
      where: { id: noteId },
      data: { text },
    });

    return { errorMessage: null };
  } catch (error) {
    return handleError(error);
  }
};

export const deleteNoteAction = async (noteId: string) => {
  try {
    const user = await getUser();
    if (!user) throw new Error("You must be logged in to delete a note");

    await prisma.note.delete({
      where: { id: noteId, authorId: user.id },
    });

    return { errorMessage: null };
  } catch (error) {
    return handleError(error);
  }
};

export const askAIAboutNotesAction = async (
  newQuestions: string[],
  responses: string[],
) => {
  try {
    const user = await getUser();
    if (!user) throw new Error("You must be logged in to ask AI questions");

    const notes = await prisma.note.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      select: { text: true, createdAt: true, updatedAt: true },
    });

    if (notes.length === 0) {
      return "You don't have any notes yet.";
    }

    const formattedNotes = notes
      .map((note: { text: string; createdAt: Date; updatedAt: Date }) =>
        `
    Text: ${note.text}
    Created at: ${note.createdAt}
    Last updated: ${note.updatedAt}
    `.trim(),
      )
      .join("\n");

    // Creating a conversation history for context
    const chatHistory = [];

    // Add system prompt
    const systemPrompt = `
      You are a helpful assistant that answers questions about a user's notes. 
      Assume all questions are related to the user's notes. 
      Make sure that your answers are not too verbose and you speak succinctly. 
      Your responses MUST be formatted in clean, valid HTML with proper structure. 
      Use tags like <p>, <strong>, <em>, <ul>, <ol>, <li>, <h1> to <h6>, and <br> when appropriate. 
      Do NOT wrap the entire response in a single <p> tag unless it's a single paragraph. 
      Avoid inline styles, JavaScript, or custom attributes.
      
      Here are the user's notes:
      ${formattedNotes}
    `;

    // Build chat history from previous questions and responses
    for (let i = 0; i < newQuestions.length - 1; i++) {
      chatHistory.push({
        role: "user",
        parts: [{ text: newQuestions[i] }],
      });

      if (responses.length > i) {
        chatHistory.push({
          role: "model",
          parts: [{ text: responses[i] }],
        });
      }
    }

    // Get the current question (last one in newQuestions array)
    const currentQuestion = newQuestions[newQuestions.length - 1];

    // Initialize the generative model with a specific model name
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro", // Replace with the actual model name
    });

    // Start a chat session
    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    });

    // Send the system prompt first if this is the first question
    if (chatHistory.length === 0) {
      await chat.sendMessage(systemPrompt);
    }

    // Send the current question and get response
    const result = await chat.sendMessage(currentQuestion);
    const response = result.response.text();

    return response || "I couldn't analyze your notes at this time.";
  } catch (error) {
    console.error("AI Assistant error:", error);
    return "Sorry, there was an error processing your request. Please try again later.";
  }
};
