import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  
  console.log('Contact form:', { name, email, subject, message });
  
  res.json({ 
    success: true, 
    message: 'Message received successfully' 
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
