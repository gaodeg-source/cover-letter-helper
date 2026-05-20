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

STEP 1 — Research the company and role:
Using the company name and job description, identify:
- What the product does, who the customers are, and the specific problem it solves
- The operational workflow this role sits inside (e.g. loan processing, patient intake, sales pipeline) and where AI is being applied within it
- The domain's constraints: is it high-stakes, compliance-heavy, latency-sensitive, or messy-data-driven? What breaks when AI gets it wrong?
- The specific AI primitives the company works with (agents, RAG, fine-tuning, evals, vector DBs, orchestration) — note which ones appear in the JD
- The exact tech stack mentioned in the JD (frameworks, languages, cloud providers, tools)
- Company stage and culture signals (early startup, growth, enterprise, regulated industry) and the appropriate tone: direct and blunt for startups, formal for regulated industries, technical for dev tools. Do not default to a generic professional tone.

STEP 2 — Extract the top 5 requirements from the job description.

STEP 3 — Select and map experiences:
Choose only the 2–3 experiences from the resume that best match both the requirements and the company's product context.
- For each selected experience, identify which of the candidate's tools or frameworks map closest to the company's stated stack. Surface those explicitly — do not list every tool the candidate knows.
- If the resume includes non-engineering experiences (sales, operations, brand-building), compress each to one sentence focused only on the most transferable angle. Do not give them equal weight to technical work.

STEP 4 — Write a cover letter under 300 words organized around 2–3 fit themes, not a project-by-project list.

STEP 5 — Revise: cut any sentence that could apply to any applicant at any company. If a claim has no concrete evidence from the resume, remove it or replace it with one that does.

WRITING RULES:
- Write in the tone you chose in Step 1.
- Connect experiences to the company's specific product context and customer workflow — not just the job requirements.
- When the role involves AI agents, orchestration, or multi-step pipelines, explicitly address that — do not reduce it to "LLM integration."
- When the domain is high-stakes (finance, healthcare, legal, operations), acknowledge reliability, edge cases, or what happens when the system fails. Do not only talk about shipping features.
- For every major claim, include one concrete detail: project name, action taken, tool used, measurable result, or stakeholder context.
- Mirror the company's stack where the resume genuinely supports it. Do not claim fluency in tools not present in the resume.
- Use confident but not presumptuous language. Do not tell the company how their own product works.
- Use concrete language: building, deploying, debugging, iterating with users, handling messy data, translating user needs into working features.
- Never write: "I am passionate about X", "I am excited about Y", "perfect fit", "AI-native", "end-to-end", "cross-functional", "stakeholder alignment", "operating in ambiguity", "rapid prototyping".
- Mention the company and role by name. Do not flatter them.
- No subject line or email header. Start with "Dear Hiring Manager," or a role-specific salutation.
- End with one short, direct closing sentence.

OUTPUT FORMAT — respond with raw valid JSON only. No markdown, no code fences, no explanation outside the JSON object:
{
  "cover_letter": "the full cover letter text",
  "targeting": "3 sentences: (1) tone chosen and why, (2) which requirements and product context you targeted, (3) which resume experiences you selected and how you mapped their stack"
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
