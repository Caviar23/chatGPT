const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
app.use(bodyParser.json());

// Load environment variables for security. Replace with your actual keys.
// You should set these in your deployment environment (e.g., Vercel, Render).
const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Helper function to get the bot's access token from Lark ---
async function getLarkAccessToken() {
  const url = 'https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal/';
  try {
    const response = await axios.post(url, {
      app_id: LARK_APP_ID,  
      app_secret: LARK_APP_SECRET
    });
    return response.data.app_access_token;
  } catch (error) {
    console.error('Error fetching Lark access token:', error.response ? error.response.data : error.message);
    return null;
  }
}

// --- Helper function to send a message back to Lark ---
async function sendMessageToLark(text, chatId, accessToken) {
  const url = 'https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id';
  try {
    await axios.post(url, {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({
        text: text
      })
    }, {
      headers: {
        'Authorization': `Bearer t-${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error sending message to Lark:', error.response ? error.response.data : error.message);
  }
}

// --- Main endpoint for Lark's event subscription ---
app.post('/', async (req, res) => {
  const data = req.body;
  const type = data.type;

  // 1. URL verification
  if (type === 'url_verification') {
    if (data.token) {
      console.log('URL verification successful.');
      return res.status(200).json({
        challenge: data.challenge
      });
    }
    return res.status(400).send('URL verification token missing.');
  }

  // 2. Event callback
  if (type === 'event_callback' && data.event && data.event.type === 'message') {
    const event = data.event;
    
    // Check if it's a direct message to the bot and not a bot's own message
    if (event.message.chat_type === 'p2p' && event.sender.sender_id.open_id !== event.bot_id) {
      const prompt = event.message.content;
      const chatId = event.message.chat_id;
      
      console.log(`Received message from chat ${chatId}: ${prompt}`);
      
      const accessToken = await getLarkAccessToken();
      if (!accessToken) {
        return res.status(500).send('Failed to get Lark access token.');
      }
      
      try {
        // Send a temporary "typing" message to let the user know the bot is working
        await sendMessageToLark('Thinking...', chatId, accessToken);

        // Make the API call to OpenAI
        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: "gpt-3.5-turbo", // You can change this to another model like gpt-4
          messages: [{
            role: "user",
            content: prompt
          }]
        }, {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        const answer = openaiResponse.data.choices[0].message.content;
        
        // Send the final answer back to Lark
        await sendMessageToLark(answer, chatId, accessToken);

      } catch (error) {
        console.error('Error calling OpenAI API:', error.response ? error.response.data : error.message);
        await sendMessageToLark('Sorry, something went wrong when I tried to generate a response. Please try again.', chatId, accessToken);
      }
    }
  }

  res.status(200).send('Event received.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
