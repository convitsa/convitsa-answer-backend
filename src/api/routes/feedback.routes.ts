import { Hono } from 'hono';
import { Resend } from 'resend';
import { z } from 'zod';
import { env } from '../../config/env';

const feedback = new Hono();

// Initialize Resend
const resend = new Resend(env.RESEND_API_KEY);

// Validation schema
const feedbackSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters').max(5000),
});

/**
 * POST /feedback
 * Submit feedback or support request
 */
feedback.post('/', async (c) => {
  try {
    // Parse and validate body
    const body = await c.req.json();
    const result = feedbackSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { 
          error: 'Validation failed', 
          details: result.error.flatten().fieldErrors 
        },
        400
      );
    }

    const { name, email, message } = result.data;

    // 1. Send notification email to Mahammad
    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: 'mahammad@convitsa.com',
      subject: `📬 New Feedback from ${name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a1a; border-bottom: 2px solid #6366f1; padding-bottom: 10px;">
            New Feedback Received
          </h2>
          
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>From:</strong> ${name}</p>
            <p style="margin: 0 0 10px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p style="margin: 0;"><strong>Received:</strong> ${new Date().toLocaleString('en-US', { 
              dateStyle: 'full', 
              timeStyle: 'short' 
            })}</p>
          </div>
          
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Message:</h3>
            <p style="color: #4b5563; line-height: 1.6; white-space: pre-wrap;">${message}</p>
          </div>
          
          <div style="margin-top: 20px;">
            <a href="mailto:${email}?subject=Re: ${name}'s message to Convitsa" 
               style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Reply to ${name}
            </a>
          </div>
        </div>
      `,
    });

    // 2. Send confirmation email to user
    await resend.emails.send({
      from: "mahammad@convitsa.com",
      to: email,
      subject: `Thanks for reaching out! - Convitsa`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1a1a1a; margin: 0;">Convitsa Answer</h1>
            <p style="color: #6b7280; margin: 5px 0 0 0;">AI Chat for your website</p>
          </div>
          
          <h2 style="color: #1a1a1a;">Hi ${name}! 👋</h2>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
            Thank you for reaching out to us! I've received your message and will get back to you as soon as possible.
          </p>
          
          <div style="background: #f0f9ff; border-left: 4px solid #6366f1; padding: 15px 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
            <p style="color: #374151; margin: 0; font-style: italic;">
              "${message}"
            </p>
          </div>
          
          <div style="background: #fef3c7; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h3 style="color: #92400e; margin-top: 0;">⚡ Need Urgent Help?</h3>
            <p style="color: #78350f; margin-bottom: 15px;">
              If you need immediate assistance, you can book a 30-minute meeting with me directly:
            </p>
            <a href="https://calendly.com/convitsa/30min" 
               style="display: inline-block; background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
              📅 Schedule a Meeting
            </a>
          </div>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
            I typically respond within 3 hours during business days.
          </p>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
            Best regards,<br>
            <strong>Mahammad</strong><br>
            <span style="color: #6b7280;">Co-founder & CEO, Convitsa</span>
          </p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <div style="text-align: center; color: #9ca3af; font-size: 14px;">
            <p style="margin: 0;">
              <a href="https://convitsa.com" style="color: #6366f1; text-decoration: none;">convitsa.com</a>
              &nbsp;•&nbsp;
              <a href="mailto:mahammad@convitsa.com" style="color: #6366f1; text-decoration: none;">mahammad@convitsa.com</a>
            </p>
          </div>
        </div>
      `,
    });

    console.log(`📬 Feedback received from ${name} (${email})`);

    return c.json({
      success: true,
      message: 'Thank you for your message! We will contact you soon.',
    });

  } catch (error) {
    console.error('Feedback submission error:', error);
    return c.json(
      { error: 'Failed to send message. Please try again later.' },
      500
    );
  }
});

export { feedback as feedbackRoutes };


