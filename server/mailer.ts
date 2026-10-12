export interface Mailer {
  sendLogin(to: string, link: string, code: string): Promise<void>;
}

/** Sends the sign-in email through Resend (https://resend.com). */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async sendLogin(to, link, code) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          subject: `Your Noise2sound sign-in code: ${code}`,
          text: `Your sign-in code is ${code}\n\nOr open this link to sign in:\n${link}\n\nBoth work for 15 minutes. If you didn't ask for this, ignore this email.`,
          html: `<p>Your sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>Or <a href="${link}">tap here to sign in</a>.</p><p style="color:#666">Both work for 15 minutes. If you didn't ask for this, ignore this email.</p>`,
        }),
      });
      if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
    },
  };
}

/** Prints the sign-in details to the server log. Only for local development. */
export function consoleMailer(): Mailer {
  return {
    async sendLogin(to, link, code) {
      console.log(`\n[dev mail] to ${to}\n  code: ${code}\n  link: ${link}\n`);
    },
  };
}
