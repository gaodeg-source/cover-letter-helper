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
    const { resume_text, job_description, company, role, tone } = req.body;

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

    const toneInstructions = {
      startup: "Write in a direct, confident tone suited for a fast-moving startup. No corporate filler.",
      formal: "Write in a formal, precise tone appropriate for traditional or regulated industries.",
      "product-focused": "Write with a product-thinking lens — emphasize user impact, prioritization, and cross-functional decisions.",
      technical: "Write with technical specificity — name tools, systems, and decisions rather than describing them vaguely.",
    };

    const toneGuide = toneInstructions[tone] || toneInstructions["startup"];

    const systemPrompt = `You are helping write a tailored cover letter. Follow this exact process:

STEP 1 — Analyze: Extract the top 5 requirements from the job description.
STEP 2 — Select: Choose only the 2–3 experiences from the resume that best match those requirements. Ignore the rest.
STEP 3 — Write: Produce a cover letter under 300 words following the rules below.
STEP 4 — Revise: Remove any sentence that could apply to any applicant. If a claim has no concrete evidence behind it, cut it or replace it with one that does.

WRITING RULES:
- ${toneGuide}
- Do not sound AI-generated or overly polished.
- Organize around 2–3 fit themes for this role, not a project-by-project summary.
- For every major claim, include one concrete detail: a specific action, project name, metric, tool, or stakeholder context from the resume.
- Do not write broad statements without evidence. Bad: "I thrive in ambiguous environments." Good: "At [X], I had to define the product scope from scratch before we had a PM — I wrote the spec, ran user interviews, and shipped v1 in six weeks."
- Avoid these words and phrases unless tied to a concrete example: AI-native, workflow design, rapid prototyping, ambiguous environments, end-to-end, operating in ambiguity, cross-functional, stakeholder alignment, passionate, excited to apply, perfect fit. Use each idea at most once.
- Mention the company and role by name, but do not flatter them excessively.
- Do not invent experience, metrics, tools, or company details.
- No subject line or email header. Start with "Dear Hiring Manager," or a role-specific salutation.
- End with a short, direct closing — one sentence.

OUTPUT FORMAT — respond with valid JSON only, no markdown fences:
{
  "cover_letter": "the full cover letter text",
  "targeting": "2–3 sentences explaining which job requirements you targeted and which resume experiences you chose, and why"
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
      const parsed = JSON.parse(message.content[0].text);
      coverLetter = parsed.cover_letter?.trim();
      targeting = parsed.targeting?.trim();
    } catch {
      // Fallback if model doesn't return clean JSON
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

// Local dev only — Vercel handles listening itself
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Cover letter agent running at http://localhost:${PORT}`));
}

module.exports = app;
