import { Resend } from 'resend';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

// Convitsa Design System Colors
const COLORS = {
  brandPurple: '#6C5DD3',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  textPrimary: '#171717',
  textSecondary: '#737373',
  textMuted: '#525252',
  background: '#FFFFFF',
  backgroundMuted: '#FAFAFA',
  border: '#E5E5E5',
};

const PLUGIN_URL = 'https://framer.com/marketplace/plugins/convitsa-answer';

/**
 * Format date consistently for emails
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Generate consistent email HTML template
 */
function getEmailTemplate(options: {
  heading: string;
  content: string;
  ctaText?: string;
  ctaUrl?: string;
  accentColor?: string;
}): string {
  const { heading, content, ctaText, ctaUrl = PLUGIN_URL, accentColor = COLORS.brandPurple } = options;

  const ctaButton = ctaText
    ? `
      <a href="${ctaUrl}" style="display: inline-block; background: ${COLORS.brandPurple}; color: #FFFFFF; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px;">
        ${ctaText}
      </a>
    `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.backgroundMuted}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 520px; margin: 0 auto; background: ${COLORS.background}; border-radius: 8px; overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px; border-bottom: 1px solid ${COLORS.border};">
              <span style="font-size: 18px; font-weight: 600; color: ${COLORS.brandPurple};">Convitsa</span>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 32px 24px;">
              <h1 style="font-size: 24px; font-weight: 600; color: ${COLORS.textPrimary}; margin: 0 0 16px; line-height: 1.25;">
                ${heading}
              </h1>
              ${content}
              ${ctaText ? `<div style="margin-top: 24px;">${ctaButton}</div>` : ''}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px; background: ${COLORS.backgroundMuted}; border-top: 1px solid ${COLORS.border};">
              <p style="font-size: 12px; color: ${COLORS.textSecondary}; margin: 0; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} Convitsa. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export class EmailService {
  /**
   * Send email verification code
   */
  static async sendVerificationEmail(to: string, code: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          Thanks for signing up! Please use the verification code below to complete your registration.
        </p>
        <div style="margin: 24px 0;">
          <p style="font-size: 32px; font-weight: 600; color: ${COLORS.brandPurple}; letter-spacing: 6px; margin: 0; text-align: center;">
            ${code}
          </p>
        </div>
        <p style="font-size: 13px; color: ${COLORS.textSecondary}; margin: 16px 0 0; line-height: 1.5;">
          This code will expire in <strong>10 minutes</strong>.
        </p>
        <p style="font-size: 13px; color: ${COLORS.textSecondary}; margin: 8px 0 0; line-height: 1.5;">
          If you didn't create an account, you can safely ignore this email.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Verify your Convitsa account',
        html: getEmailTemplate({ heading: 'Verify your email', content }),
        text: `Your Convitsa verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't create an account, you can safely ignore this email.`,
      });

      console.log(`✉️ Verification email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Send password reset code
   */
  static async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          We received a request to reset your password. Use the code below to complete the process.
        </p>
        <div style="margin: 24px 0;">
          <p style="font-size: 32px; font-weight: 600; color: ${COLORS.brandPurple}; letter-spacing: 6px; margin: 0; text-align: center;">
            ${code}
          </p>
        </div>
        <p style="font-size: 13px; color: ${COLORS.textSecondary}; margin: 16px 0 0; line-height: 1.5;">
          This code will expire in <strong>10 minutes</strong>.
        </p>
        <p style="font-size: 13px; color: ${COLORS.textSecondary}; margin: 8px 0 0; line-height: 1.5;">
          If you didn't request a password reset, you can safely ignore this email.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Reset your Convitsa password',
        html: getEmailTemplate({ heading: 'Reset your password', content }),
        text: `Your Convitsa password reset code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request a password reset, you can safely ignore this email.`,
      });

      console.log(`✉️ Password reset email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Send welcome email after verification
   */
  static async sendWelcomeEmail(to: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 16px; line-height: 1.5;">
          Thanks for verifying your email. You're all set to start using Convitsa.
        </p>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 8px; line-height: 1.5;">
          Here's what you can do:
        </p>
        <ul style="margin: 0 0 16px; padding-left: 20px; color: ${COLORS.textMuted}; font-size: 14px; line-height: 1.6;">
          <li>Create projects for your websites</li>
          <li>Add AI-powered chat to your Framer sites</li>
          <li>Capture leads and answer questions automatically</li>
        </ul>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Welcome to Convitsa',
        html: getEmailTemplate({ heading: 'Welcome to Convitsa', content, ctaText: 'Get Started' }),
        text: `Welcome to Convitsa!\n\nThanks for verifying your email. You're all set to start using Convitsa.\n\nHere's what you can do:\n- Create projects for your websites\n- Add AI-powered chat to your Framer sites\n- Capture leads and answer questions automatically\n\nGet started: ${PLUGIN_URL}`,
      });

      console.log(`✉️ Welcome email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }
  }

  /**
   * Send payment welcome email (for users who subscribed via direct/affiliate payment)
   * Includes generated password for immediate login
   */
  static async sendPaymentWelcomeEmail(
    to: string,
    password: string,
    planName: string,
    bonusTokens: number = 0
  ): Promise<void> {
    try {
      const bonusSection = bonusTokens > 0 ? `
        <div style="margin: 16px 0; padding: 16px; background: ${COLORS.backgroundMuted}; border-radius: 6px;">
          <p style="font-size: 14px; color: ${COLORS.success}; margin: 0; font-weight: 500;">
            🎁 Bonus: You received ${bonusTokens.toLocaleString()} extra tokens!
          </p>
        </div>
      ` : '';

      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 16px; line-height: 1.5;">
          Thank you for subscribing to <strong>${planName}</strong>! Your payment was successful and your account is ready.
        </p>
        ${bonusSection}
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 16px; line-height: 1.5;">
          Here are your login credentials:
        </p>
        <div style="margin: 24px 0; padding: 20px; background: ${COLORS.backgroundMuted}; border-radius: 6px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Email</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${to}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Password</td>
              <td style="padding: 8px 0; font-size: 16px; color: ${COLORS.brandPurple}; text-align: right; font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; letter-spacing: 1px;">${password}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 16px 0 0; line-height: 1.5;">
          To get started:
        </p>
        <ol style="margin: 8px 0 0; padding-left: 20px; color: ${COLORS.textMuted}; font-size: 14px; line-height: 1.6;">
          <li>Open the <strong>Convitsa</strong> plugin in Framer</li>
          <li>Log in with your email and password above</li>
          <li>Complete the quick setup to start using AI chat</li>
        </ol>
        <p style="font-size: 13px; color: ${COLORS.warning}; margin: 24px 0 0; line-height: 1.5;">
          <strong>Security tip:</strong> We recommend changing your password after logging in.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `Welcome to ${planName} - Your login details`,
        html: getEmailTemplate({ heading: 'Welcome to Convitsa!', content, ctaText: 'Open Convitsa' }),
        text: `Thank you for subscribing to ${planName}!\n\n${bonusTokens > 0 ? `Bonus: You received ${bonusTokens.toLocaleString()} extra tokens!\n\n` : ''}Your login credentials:\nEmail: ${to}\nPassword: ${password}\n\nTo get started:\n1. Open the Convitsa plugin in Framer\n2. Log in with your email and password above\n3. Complete the quick setup to start using AI chat\n\nSecurity tip: We recommend changing your password after logging in.`,
      });

      console.log(`✉️ Payment welcome email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send payment welcome email:', error);
    }
  }

  /**
   * Send subscription started email
   * @param billingInterval - 'monthly' or 'yearly'
   */
  static async sendSubscriptionStartedEmail(
    to: string,
    planName: string,
    price: number,
    tokensPerMonth: number,
    nextBillingDate: Date,
    billingInterval: 'monthly' | 'yearly' = 'monthly'
  ): Promise<void> {
    try {
      const isYearly = billingInterval === 'yearly';
      const priceLabel = isYearly ? `$${price}/year` : `$${price}/month`;
      const tokenRefreshNote = isYearly 
        ? `<tr>
            <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Token refresh</td>
            <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">Monthly</td>
          </tr>`
        : '';

      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          Thank you for subscribing! Your ${planName} plan is now active.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Plan</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${planName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Price</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${priceLabel}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Tokens</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.success}; text-align: right; font-weight: 500;">${tokensPerMonth.toLocaleString()}/month</td>
            </tr>
            ${tokenRefreshNote}
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Next billing</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${formatDate(nextBillingDate)}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.5;">
          Your tokens are ready to use${isYearly ? ' and refresh monthly' : ''}. Enjoy Convitsa!
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `Welcome to ${planName}`,
        html: getEmailTemplate({ heading: 'Subscription activated', content, ctaText: 'Open Convitsa', accentColor: COLORS.success }),
        text: `Thank you for subscribing!\n\nPlan: ${planName}\nPrice: ${priceLabel}\nTokens: ${tokensPerMonth.toLocaleString()}/month${isYearly ? ' (refresh monthly)' : ''}\nNext billing: ${formatDate(nextBillingDate)}\n\nYour tokens are ready to use. Enjoy Convitsa!`,
      });

      console.log(`✉️ Subscription started email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send subscription started email:', error);
    }
  }

  /**
   * Send subscription renewed email
   */
  static async sendSubscriptionRenewedEmail(
    to: string,
    planName: string,
    tokensReset: number,
    nextBillingDate: Date,
    billingInterval: 'monthly' | 'yearly' = 'monthly'
  ): Promise<void> {
    try {
      const isYearly = billingInterval === 'yearly';
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          Your ${planName} subscription has been renewed and your tokens have been reset.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Tokens available</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.success}; text-align: right; font-weight: 500;">${tokensReset.toLocaleString()}</td>
            </tr>
            ${isYearly ? `<tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Token refresh</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">Monthly</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Next billing</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${formatDate(nextBillingDate)}</td>
            </tr>
          </table>
        </div>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Your subscription has been renewed',
        html: getEmailTemplate({ heading: 'Subscription renewed', content, ctaText: 'Open Convitsa' }),
        text: `Your ${planName} subscription has been renewed.\n\nTokens available: ${tokensReset.toLocaleString()}${isYearly ? ' (refresh monthly)' : ''}\nNext billing: ${formatDate(nextBillingDate)}`,
      });

      console.log(`✉️ Subscription renewed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send subscription renewed email:', error);
    }
  }

  /**
   * Send subscription cancelled email
   */
  static async sendSubscriptionCancelledEmail(
    to: string,
    planName: string,
    accessEndsDate: Date
  ): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 16px; line-height: 1.5;">
          Your ${planName} subscription has been cancelled. You will continue to have access until the end of your billing period.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Access until</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${formatDate(accessEndsDate)}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.5;">
          Changed your mind? You can reactivate your subscription anytime before ${formatDate(accessEndsDate)}.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Your subscription has been cancelled',
        html: getEmailTemplate({ heading: 'Subscription cancelled', content, ctaText: 'Reactivate Subscription' }),
        text: `Your ${planName} subscription has been cancelled.\n\nYou will continue to have access until ${formatDate(accessEndsDate)}.\n\nChanged your mind? You can reactivate your subscription anytime.`,
      });

      console.log(`✉️ Subscription cancelled email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send subscription cancelled email:', error);
    }
  }

  /**
   * Send subscription reactivated email
   */
  static async sendSubscriptionReactivatedEmail(to: string, planName: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 16px; line-height: 1.5;">
          Great news! Your ${planName} subscription has been reactivated. Your plan will continue without interruption.
        </p>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.5;">
          Thank you for staying with Convitsa.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Your subscription has been reactivated',
        html: getEmailTemplate({ heading: 'Subscription reactivated', content, ctaText: 'Open Convitsa', accentColor: COLORS.success }),
        text: `Great news! Your ${planName} subscription has been reactivated. Your plan will continue without interruption.\n\nThank you for staying with Convitsa.`,
      });

      console.log(`✉️ Subscription reactivated email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send subscription reactivated email:', error);
    }
  }

  /**
   * Send payment failed email
   */
  static async sendPaymentFailedEmail(to: string, planName: string, retryDate: Date): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 16px; line-height: 1.5;">
          We were unable to process your payment for the ${planName} plan. Please update your payment method to avoid service interruption.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Next retry</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.warning}; text-align: right; font-weight: 500;">${formatDate(retryDate)}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 13px; color: ${COLORS.textSecondary}; margin: 0; line-height: 1.5;">
          If payment continues to fail, your subscription will be paused.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Payment failed - action required',
        html: getEmailTemplate({ heading: 'Payment failed', content, ctaText: 'Update Payment Method', accentColor: COLORS.warning }),
        text: `We were unable to process your payment for the ${planName} plan.\n\nPlease update your payment method to avoid service interruption.\n\nNext retry: ${formatDate(retryDate)}`,
      });

      console.log(`✉️ Payment failed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send payment failed email:', error);
    }
  }

  /**
   * Send low tokens warning email
   */
  static async sendLowTokensWarningEmail(to: string, tokensRemaining: number, tokensLimit: number): Promise<void> {
    try {
      const usagePercent = Math.round(((tokensLimit - tokensRemaining) / tokensLimit) * 100);
      
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          Your token balance is running low. Consider upgrading your plan to avoid service interruption.
        </p>
        <div style="margin: 24px 0; text-align: center;">
          <p style="font-size: 48px; font-weight: 600; color: ${COLORS.warning}; margin: 0;">
            ${tokensRemaining.toLocaleString()}
          </p>
          <p style="font-size: 14px; color: ${COLORS.textSecondary}; margin: 8px 0 0;">
            tokens remaining (${usagePercent}% used)
          </p>
        </div>
        <p style="font-size: 13px; color: ${COLORS.textSecondary}; margin: 0; line-height: 1.5;">
          When your tokens run out, your AI chatbot will stop responding until the next billing cycle.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Your tokens are running low',
        html: getEmailTemplate({ heading: 'Low token balance', content, ctaText: 'Upgrade Plan', accentColor: COLORS.warning }),
        text: `Your token balance is running low.\n\nTokens remaining: ${tokensRemaining.toLocaleString()} (${usagePercent}% used)\n\nWhen your tokens run out, your AI chatbot will stop responding until the next billing cycle.`,
      });

      console.log(`✉️ Low tokens warning email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send low tokens warning email:', error);
    }
  }

  /**
   * Send tokens depleted email
   */
  static async sendTokensDepletedEmail(to: string, tier: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          You've used all your tokens for this billing period. Your AI chatbot will resume responding when your tokens reset at the start of your next billing cycle.
        </p>
        <div style="margin: 24px 0; text-align: center;">
          <p style="font-size: 48px; font-weight: 600; color: ${COLORS.error}; margin: 0;">
            0
          </p>
          <p style="font-size: 14px; color: ${COLORS.textSecondary}; margin: 8px 0 0;">
            tokens remaining
          </p>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.5;">
          Need more tokens? Upgrade to a higher plan for increased limits.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Your tokens have run out',
        html: getEmailTemplate({ heading: 'Tokens depleted', content, ctaText: 'Upgrade Plan', accentColor: COLORS.error }),
        text: `You've used all your tokens for this billing period.\n\nYour AI chatbot will resume responding when your tokens reset at the start of your next billing cycle.\n\nNeed more tokens? Upgrade to a higher plan for increased limits.`,
      });

      console.log(`✉️ Tokens depleted email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send tokens depleted email:', error);
    }
  }

  /**
   * Send crawl completed email
   */
  static async sendCrawlCompletedEmail(to: string, projectName: string, pagesCount: number): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          We've finished crawling your website. Your AI chatbot is now ready to answer questions about it.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Project</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${projectName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Pages indexed</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.success}; text-align: right; font-weight: 500;">${pagesCount}</td>
            </tr>
          </table>
        </div>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `${projectName} - crawl completed`,
        html: getEmailTemplate({ heading: 'Website indexed', content, ctaText: 'View Project', accentColor: COLORS.success }),
        text: `We've finished crawling your website.\n\nProject: ${projectName}\nPages indexed: ${pagesCount}\n\nYour AI chatbot is now ready to answer questions about it.`,
      });

      console.log(`✉️ Crawl completed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send crawl completed email:', error);
    }
  }

  /**
   * Send crawl failed email
   */
  static async sendCrawlFailedEmail(to: string, projectName: string, errorMessage: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          We encountered an error while crawling your website.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Project</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${projectName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Error</td>
              <td style="padding: 8px 0; font-size: 13px; color: ${COLORS.error}; text-align: right;">${errorMessage}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 8px; line-height: 1.5;">
          <strong>Common fixes:</strong>
        </p>
        <ul style="margin: 0; padding-left: 20px; color: ${COLORS.textSecondary}; font-size: 13px; line-height: 1.6;">
          <li>Make sure the website URL is correct and accessible</li>
          <li>Check if the website allows web crawlers</li>
          <li>Try again in a few minutes</li>
        </ul>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `${projectName} - crawl failed`,
        html: getEmailTemplate({ heading: 'Crawl failed', content, ctaText: 'Try Again', accentColor: COLORS.error }),
        text: `We encountered an error while crawling your website.\n\nProject: ${projectName}\nError: ${errorMessage}\n\nCommon fixes:\n- Make sure the website URL is correct and accessible\n- Check if the website allows web crawlers\n- Try again in a few minutes`,
      });

      console.log(`✉️ Crawl failed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send crawl failed email:', error);
    }
  }

  /**
   * Send document processing completed email
   */
  static async sendDocumentCompletedEmail(to: string, fileName: string, projectName: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          Your document has been processed and added to your AI's knowledge base.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">File</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${fileName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Project</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${projectName}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.5;">
          Your AI chatbot can now answer questions based on this document.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `${fileName} processed successfully`,
        html: getEmailTemplate({ heading: 'Document processed', content, ctaText: 'View Project', accentColor: COLORS.success }),
        text: `Your document has been processed.\n\nFile: ${fileName}\nProject: ${projectName}\n\nYour AI chatbot can now answer questions based on this document.`,
      });

      console.log(`✉️ Document completed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send document completed email:', error);
    }
  }

  /**
   * Send document processing failed email
   */
  static async sendDocumentFailedEmail(to: string, fileName: string, errorMessage: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          We encountered an error while processing your document.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">File</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${fileName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Error</td>
              <td style="padding: 8px 0; font-size: 13px; color: ${COLORS.error}; text-align: right;">${errorMessage}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 8px; line-height: 1.5;">
          <strong>Common fixes:</strong>
        </p>
        <ul style="margin: 0; padding-left: 20px; color: ${COLORS.textSecondary}; font-size: 13px; line-height: 1.6;">
          <li>Make sure the file is not corrupted</li>
          <li>Try a different file format (PDF, DOCX, TXT)</li>
          <li>Check if the document contains readable text</li>
        </ul>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `${fileName} processing failed`,
        html: getEmailTemplate({ heading: 'Document processing failed', content, ctaText: 'Upload Another File', accentColor: COLORS.error }),
        text: `We encountered an error while processing your document.\n\nFile: ${fileName}\nError: ${errorMessage}\n\nCommon fixes:\n- Make sure the file is not corrupted\n- Try a different file format (PDF, DOCX, TXT)\n- Check if the document contains readable text`,
      });

      console.log(`✉️ Document failed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send document failed email:', error);
    }
  }

  /**
   * Send new lead notification email
   */
  static async sendNewLeadEmail(
    to: string,
    projectName: string,
    email?: string,
    phone?: string,
    name?: string
  ): Promise<void> {
    try {
      const leadRows: string[] = [];
      if (name) leadRows.push(`<tr><td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Name</td><td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${name}</td></tr>`);
      if (email) leadRows.push(`<tr><td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Email</td><td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${email}</td></tr>`);
      if (phone) leadRows.push(`<tr><td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Phone</td><td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${phone}</td></tr>`);

      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          Your AI chatbot on <strong>${projectName}</strong> just captured a new lead.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            ${leadRows.join('')}
            <tr>
              <td style="padding: 8px 0; font-size: 13px; color: ${COLORS.textSecondary};">Captured at</td>
              <td style="padding: 8px 0; font-size: 13px; color: ${COLORS.textSecondary}; text-align: right;">${new Date().toLocaleString()}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.5;">
          Follow up quickly to maximize your conversion rate!
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `New lead on ${projectName}`,
        html: getEmailTemplate({ heading: 'New lead captured', content, ctaText: 'View Lead', accentColor: COLORS.success }),
        text: `New lead captured on ${projectName}!\n\n${name ? `Name: ${name}\n` : ''}${email ? `Email: ${email}\n` : ''}${phone ? `Phone: ${phone}\n` : ''}\nCaptured at: ${new Date().toLocaleString()}\n\nFollow up quickly to maximize your conversion rate!`,
      });

      console.log(`✉️ New lead email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send new lead email:', error);
    }
  }

  /**
   * Send API key created email
   */
  static async sendApiKeyCreatedEmail(to: string, keyName: string, keyPrefix: string): Promise<void> {
    try {
      const content = `
        <p style="font-size: 14px; color: ${COLORS.textMuted}; margin: 0 0 24px; line-height: 1.5;">
          A new API key was created for your Convitsa account.
        </p>
        <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Key name</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-weight: 500;">${keyName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textSecondary};">Key prefix</td>
              <td style="padding: 8px 0; font-size: 14px; color: ${COLORS.textPrimary}; text-align: right; font-family: 'SF Mono', 'Fira Code', monospace;">${keyPrefix}...</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 13px; color: ${COLORS.warning}; margin: 0; line-height: 1.5;">
          <strong>Security notice:</strong> If you didn't create this API key, please secure your account immediately.
        </p>
      `;

      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `New API key created: ${keyName}`,
        html: getEmailTemplate({ heading: 'API key created', content, ctaText: 'Manage API Keys' }),
        text: `A new API key was created for your Convitsa account.\n\nKey name: ${keyName}\nKey prefix: ${keyPrefix}...\n\nSecurity notice: If you didn't create this API key, please secure your account immediately.`,
      });

      console.log(`✉️ API key created email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send API key created email:', error);
    }
  }

  // Legacy method aliases for backwards compatibility
  static async sendCreditsPurchasedEmail(to: string, credits: number, newBalance: number): Promise<void> {
    // Redirect to subscription started for new subscription model
    await this.sendSubscriptionStartedEmail(to, 'Pro', 29, newBalance, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  }

  static async sendLowCreditsWarningEmail(to: string, balance: number): Promise<void> {
    await this.sendLowTokensWarningEmail(to, balance, 100000);
  }

  static async sendCreditsDepletedEmail(to: string): Promise<void> {
    await this.sendTokensDepletedEmail(to, 'free');
  }
}
