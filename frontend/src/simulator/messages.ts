import type { Channel, MatchedDonor } from "../api";
import { groupLabel } from "../format";
import type { Appeal } from "./useAppeal";

/* What each recipient receives, and the link that opens it ready to send. */

export const CHANNELS: { id: Channel; name: string }[] = [
  { id: "whatsapp", name: "WhatsApp" },
  { id: "sms", name: "SMS" },
  { id: "email", name: "Email" },
];
export const channelName = (c: Channel) => CHANNELS.find((x) => x.id === c)!.name;

export interface Message {
  text: string;
  subject: string;
}

/** "14 March 2026" */
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** The appeal exactly as written: for the public, or everyone with a blood type. */
export const generalMessage = (appeal: Appeal, channel: Channel): Message => ({
  text: appeal[channel],
  subject: appeal.emailSubject,
});

/** The appeal with the donor's name and a nudge about their last donation in front. */
export function personalMessage(appeal: Appeal, channel: Channel, d: MatchedDonor): Message {
  const first = d.name.split(" ")[0];
  const g = groupLabel(d.blood_group);
  const a = /^[AO]/.test(g) ? "an" : "a"; // an O+ donor, a B+ donor
  if (channel === "sms") {
    const nudge = d.last_donated
      ? `${first}, you last gave blood on ${longDate(d.last_donated)} and can give again now.`
      : `${first}, you are registered with us as ${a} ${g} donor.`;
    return { text: `${nudge} ${appeal.sms}`, subject: "" };
  }
  const nudge = d.last_donated
    ? `Dear ${first},\n\nThe last time you gave blood was ${longDate(d.last_donated)}, so you are able to donate again, and ${g} blood like yours is urgently needed.`
    : `Dear ${first},\n\nYou are registered with us as ${a} ${g} blood donor, and ${g} blood like yours is urgently needed.`;
  // The email appeal is a letter to "Dear friend": greet the donor by name instead.
  const body = channel === "email" ? appeal.email.replace(/^Dear friend,?\s*/i, "") : appeal.whatsapp;
  return { text: `${nudge}\n\n${body}`, subject: `${first}, your ${g} blood is urgently needed` };
}

/** The contact detail a channel needs: a phone for WhatsApp and SMS, an email for email. */
export const contactFor = (channel: Channel, d: MatchedDonor) => (channel === "email" ? d.email : d.phone);

/** A link that opens the message ready to send: to one or more recipients, or (none) for
 *  the sender to choose. WhatsApp takes one number per message. */
export function sendLink(channel: Channel, msg: Message, to: string[] = []): string {
  const enc = encodeURIComponent;
  if (channel === "whatsapp") return `https://wa.me/${(to[0] ?? "").replace(/\D/g, "")}?text=${enc(msg.text)}`;
  if (channel === "sms") return `sms:${to.join(",")}?&body=${enc(msg.text)}`;
  // Several recipients go in BCC, so donors don't see each other's addresses.
  const bcc = to.length > 1 ? `bcc=${to.map(enc).join(",")}&` : "";
  return `mailto:${to.length === 1 ? to[0] : ""}?${bcc}subject=${enc(msg.subject)}&body=${enc(msg.text)}`;
}
