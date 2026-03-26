import nodemailer from "nodemailer";
import twilio from "twilio";

import { config } from "../config.js";

let transporter;
let whatsappClient;

function getTransporter() {
  if (
    !config.email.host ||
    !config.email.user ||
    !config.email.pass ||
    !config.email.from
  ) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    });
  }

  return transporter;
}

function getWhatsappClient() {
  if (
    !config.twilio.accountSid ||
    !config.twilio.authToken ||
    !config.twilio.whatsappFrom
  ) {
    return null;
  }

  if (!whatsappClient) {
    whatsappClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }

  return whatsappClient;
}

export async function sendOutboundNotice({
  email,
  subject,
  message,
  whatsappTo
}) {
  const tasks = [];
  const activeTransporter = getTransporter();
  const activeWhatsappClient = getWhatsappClient();

  if (activeTransporter && email) {
    tasks.push(
      activeTransporter.sendMail({
        from: config.email.from,
        to: email,
        subject,
        text: message
      })
    );
  }

  if (activeWhatsappClient && whatsappTo) {
    tasks.push(
      activeWhatsappClient.messages.create({
        from: `whatsapp:${config.twilio.whatsappFrom.replace(/^whatsapp:/, "")}`,
        to: whatsappTo.startsWith("whatsapp:") ? whatsappTo : `whatsapp:${whatsappTo}`,
        body: `${subject}\n\n${message}`
      })
    );
  }

  if (tasks.length === 0) {
    return;
  }

  try {
    await Promise.allSettled(tasks);
  } catch (error) {
    console.warn("Outbound notification failed", error.message);
  }
}
