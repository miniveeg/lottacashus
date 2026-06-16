import nodemailer from "npm:nodemailer@6.9.13";

type CodeEmailKind = "signup" | "password-reset";

function codeEmailContent(kind: CodeEmailKind, code: string) {
  if (kind === "password-reset") {
    return {
      subject: "Your LottaCash password reset code",
      text: `Your password reset code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
      footer: "If you didn't request a password reset, you can ignore this email.",
    };
  }
  return {
    subject: "Your LottaCash verification code",
    text: `Your LottaCash verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
    footer: "If you didn't sign up, you can ignore this email.",
  };
}

async function sendCodeEmail(to: string, code: string, kind: CodeEmailKind): Promise<void> {
  const { subject, text, footer } = codeEmailContent(kind, code);
  const host = Deno.env.get("SMTP_HOST");
  const port = Number(Deno.env.get("SMTP_PORT") ?? "587");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  const from = Deno.env.get("SMTP_FROM") ?? user;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in Supabase Edge Function secrets."
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: from ?? user,
    to,
    subject,
    text,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#f5b942;margin:0 0 16px;">LottaCash</h2>
        <p>Your code is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#f4f4f5;background:#12151c;padding:16px 24px;border-radius:12px;text-align:center;">${code}</p>
        <p style="color:#71717a;font-size:14px;">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#71717a;font-size:14px;">${footer}</p>
      </div>
    `,
  });
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  await sendCodeEmail(to, code, "signup");
}

export async function sendPasswordResetEmail(to: string, code: string): Promise<void> {
  await sendCodeEmail(to, code, "password-reset");
}
