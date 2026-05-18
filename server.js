require("dotenv").config();
const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const pdf = require("pdf-parse");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/generate", upload.single("resume_pdf"), async (req, res) => {
  try {
    const { resume_text, job_description, company, role, tone } = req.body;

    let resumeContent = resume_text?.trim() || "";

    if (req.file) {
      const pdfData = await pdf(req.file.buffer);
      resumeContent = pdfData.text.trim();
    }

    if (!resumeContent) {
      return res.status(400).json({ error: "Please provide a resume (upload PDF or paste text)." });
    }
    if (!job_description?.trim()) {
      return res.status(400).json({ error: "Job description is required." });
    }
    if (!company?.trim() || !role?.trim()) {
      return res.status(400).json({ error: "Company name and role title are required." });
    }

    const toneInstructions = {
      startup: "Use an energetic, concise tone that shows entrepreneurial mindset and adaptability.",
      formal: "Use a formal, polished tone appropriate for traditional industries.",
      "product-focused": "Use a product-focused tone emphasizing user impact, product thinking, and cross-functional collaboration.",
      technical: "Use a technical, precise tone that highlights engineering depth and technical achievements.",
    };

    const toneGuide = toneInstructions[tone] || toneInstructions["startup"];

    const systemPrompt = `You are a cover letter assistant. Given a resume and a job description, write a concise, tailored cover letter.

Requirements:
- ${toneGuide}
- Do not invent experience or skills not present in the resume.
- Emphasize exactly 2-3 experiences most relevant to the job description.
- Connect the candidate's background to the company's product and responsibilities.
- Keep it under 350 words.
- Avoid generic phrases like "I am a perfect fit", "I am passionate about", "I am excited to apply".
- End with a brief, confident closing.
- Do not include a subject line or email header.
- Start directly with "Dear Hiring Manager," or a role-specific salutation.
- Output only the cover letter text, nothing else.`;

    const userPrompt = `Resume:
${resumeContent}

Job Description:
${job_description.trim()}

Company: ${company.trim()}
Role: ${role.trim()}

Write a tailored cover letter for this position.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const coverLetter = message.content[0].text;
    const wordCount = coverLetter.split(/\s+/).filter(Boolean).length;

    res.json({ cover_letter: coverLetter, word_count: wordCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate cover letter." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cover letter agent running at http://localhost:${PORT}`));
