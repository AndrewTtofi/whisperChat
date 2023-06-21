import express from "express";
import { v4 as uuidv4 } from "uuid";
import pineconeAPI from "../api/pineconeAPI.js";
import openaiAPI from "../api/openaiAPI.js";
import Conversation from "../models/Conversation.js";
import langChainAPI from "../api/langChainAPI.js";
import { templates } from "../templates/templates.js";

const router = express.Router();
async function getUserConversationHistory(pineconeResponse) {
  console.log("Backend - Retrieving User Message History...");
  let conversationHistory = "";
  // Retrieve Conversation History from MongoDB, from Pinecone response
  try {
    await Promise.all(
      pineconeResponse.map(async (conversation) => {
        const conversationTurn = await Conversation.findOne({
          id: conversation.id,
        }).exec();
        conversationHistory += `${conversationTurn.message}. ${conversationTurn.response}. ${conversationTurn.date}\n`;
      })
    );

    console.log(
      `Backend - User Message History Retrieved: \n${conversationHistory}`
    );
  } catch (err) {
    console.error(
      `Backend - Failed to Retrieve User Message History: \n${err.message}`
    );
  }
  return conversationHistory;
}

async function sendMessage(userName, message, role = "user") {
  console.log(`Backend - Preparing to Send Message: \n${message}`);
  try {
    let messages = [],
      openaiResponse,
      pineconeResponse,
      newConversation;

    pineconeResponse = await pineconeAPI.getConversationFromPinecone(
      userName,
      message,
      process.env.PINECONE_TOPK
    );
    // If a conversation is found in Pinecone, retrieve the conversation history from MongoDB
    if (pineconeResponse?.length > 0) {
      let userConversationHistory = await getUserConversationHistory(
        pineconeResponse
      );
      // Summarize the conversation history using Langchain - Currently includes random text and causes issues.
      // Temporarily disabled until a solution is found regarding Langchain Hallucinations
      if (process.env.LANGCHAIN_ENABLED === "true") {
        userConversationHistory = await langChainAPI.summarizeConversation(
          message,
          userConversationHistory
        );
      }
      // Add the summarized history to the messages array
      messages.push({
        role: "system",
        content: userConversationHistory,
      });
    }
    // Adjust how the AI responds based on the user's response type
    messages.push({
      role: "system",
      content: templates.adjust_response_type,
    });
    // Add the user's message to the messages array
    messages.push({
      role: role,
      content: message,
    });

    openaiResponse = await openaiAPI.generateResponseFromOpenAI(
      messages,
      userName
    );
    // Save the conversation to MongoDB
    const id = uuidv4();
    console.log(`Backend - Id: ${id}`);
    newConversation = new Conversation({
      id: id,
      username: userName,
      message: `${userName} prompt: ${message}`,
      response: `AI response: ${openaiResponse}`,
      date: `Date: ${new Date()}`,
    });
    await newConversation.save();
    console.log("Backend - Saved conversation to MongoDB");
    // Store the conversation to Pinecone
    await pineconeAPI.storeConversationToPinecone(newConversation);

    return openaiResponse;
  } catch (err) {
    console.log(`Backend - Error with Request: ${err}`);
  }
}

router.get("/", (req, res) => {
  res.status(200).json({
    message: `You've reached the /message server route, running on port ${process.env.SERVER_PORT}`,
  });
});

router.post("/", async (req, res) => {
  let role = "user",
    userName = req.body.username,
    message = req.body.message;
  const response = await sendMessage(userName, message, role);
  res.json({ message: response });
});

export default router;
