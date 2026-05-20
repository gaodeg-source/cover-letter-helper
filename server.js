require("dotenv").config();
const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/generate", upload.single("resume_pdf"), async (req, res) => {
  try {
    const { resume_text, job_description, company, role } = req.body;

    let resumeContent = resume_text?.trim() || "";

    if (req.file) {
      // pdf-parse has a known init bug in serverless — import from the lib path directly
      const pdf = require("pdf-parse/lib/pdf-parse");
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

    const systemPrompt = `You are helping write a tailored cover letter. Follow this exact process:

STEP 1 — Research the company: Using the company name and job description, infer:
- What the product does, who the customers are, and what problem it solves
- The specific workflow, pain point, or industry context this role operates in
- Company stage and culture (early startup, growth, enterprise, agency, regulated industry, etc.)
- The right tone: e.g. direct and technical for dev tools, conversational for consumer products, formal for finance or legal, crisp and metrics-driven for growth roles. Choose based on signals in the JD — do not default to a generic professional tone.

STEP 2 — Extract requirements: Identify the top 5 requirements from the job description.

STEP 3 — Match to context: Select only the 2–3 experiences from the resume that best match both the requirements AND the company's specific product context. Ignore the rest.

STEP 4 — Write: Produce a cover letter under 300 words.

STEP 5 — Revise: Remove any sentence that could apply to any applicant or any company. If a claim has no concrete evidence, cut it.

WRITING RULES:
- Use the tone you inferred in Step 1. Do not write in a generic professional tone.
- Do not just match experiences to job requirements. Rewrite so the candidate's experiences sound directly relevant to this company's specific product, customer type, and workflow — without inventing skills or results they don't have.
- For every major claim, include one concrete detail: a specific action, project name, metric, tool, or stakeholder context from the resume.
- Use concrete language: building, deploying, iterating with users, handling messy data, translating ambiguous user needs into working features. Never write "I am passionate about X" or "I am excited about Y."
- Avoid these phrases entirely: passionate, excited to apply, perfect fit, AI-native, workflow design, rapid prototyping, end-to-end, cross-functional, stakeholder alignment, operating in ambiguity.
- Organize around 2–3 fit themes, not a project-by-project summary.
- Do not invent experience, metrics, tools, or company details.
- Mention the company and role by name. Do not flatter them.
- No subject line or email header. Start with "Dear Hiring Manager," or a role-specific salutation.
- End with one short, direct closing sentence.

OUTPUT FORMAT — respond with raw valid JSON only. No markdown, no code fences, no explanation outside the JSON object:
{
  "cover_letter": "the full cover letter text",
  "targeting": "2–3 sentences: what tone you chose and why, which requirements you targeted, and which resume experiences you selected"
}`;

    const userPrompt = `Resume:
${resumeContent}

Job Description:
${job_description.trim()}

Company: ${company.trim()}
Role: ${role.trim()}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    let coverLetter, targeting;
    try {
      const raw = message.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      coverLetter = parsed.cover_letter?.trim();
      targeting = parsed.targeting?.trim();
    } catch {
      coverLetter = message.content[0].text.trim();
      targeting = null;
    }

    const wordCount = coverLetter.split(/\s+/).filter(Boolean).length;

    res.json({ cover_letter: coverLetter, targeting, word_count: wordCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate cover letter." });
  }
});

app.post("/extract-pdf", upload.single("resume_pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF file provided." });
    const pdf = require("pdf-parse/lib/pdf-parse");
    const pdfData = await pdf(req.file.buffer);
    res.json({ text: pdfData.text.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to extract PDF text." });
  }
});

// Local dev only — Vercel handles listening itself
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Cover letter agent running at http://localhost:${PORT}`));
}

module.exports = app;
