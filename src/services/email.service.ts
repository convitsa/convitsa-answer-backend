import { Resend } from 'resend';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

export class EmailService {
  /**
   * Send email verification code
   */
  static async sendVerificationEmail(to: string, code: string): Promise<void> {
    try {
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Verify your Convitsa Answer account',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Convitsa Answer</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Verify your email address</h2>
              <p>Thanks for signing up! Please use the verification code below to complete your registration:</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${code}</span>
              </div>
              <p style="color: #666; font-size: 14px;">This code will expire in <strong>10 minutes</strong>.</p>
              <p style="color: #666; font-size: 14px;">If you didn't create an account with Convitsa Answer, you can safely ignore this email.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Your Convitsa Answer verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't create an account, you can safely ignore this email.`,
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
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Reset your Convitsa Answer password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Convitsa Answer</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Reset your password</h2>
              <p>We received a request to reset your password. Use the code below to complete the process:</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${code}</span>
              </div>
              <p style="color: #666; font-size: 14px;">This code will expire in <strong>10 minutes</strong>.</p>
              <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Your Convitsa Answer password reset code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request a password reset, you can safely ignore this email.`,
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
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: 'Welcome to Convitsa Answer!',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Convitsa Answer!</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">You're all set! 🎉</h2>
              <p>Thanks for verifying your email. You can now:</p>
              <ul style="padding-left: 20px;">
                <li>Create projects for your websites</li>
                <li>Add AI-powered chat to your Framer sites</li>
                <li>Let visitors get instant answers from your content</li>
              </ul>
              <p>Get started by creating your first project in the dashboard.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Go to Dashboard</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Welcome to Convitsa Answer!\n\nYou're all set! Thanks for verifying your email.\n\nYou can now:\n- Create projects for your websites\n- Add AI-powered chat to your Framer sites\n- Let visitors get instant answers from your content\n\nGet started at https://app.convitsa.com/dashboard`,
      });

      console.log(`✉️ Welcome email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      // Don't throw - welcome email is not critical
    }
  }

  /**
   * Send credits purchased confirmation email
   */
  static async sendCreditsPurchasedEmail(to: string, credits: number, newBalance: number): Promise<void> {
    try {
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `🎉 ${credits} credits added to your account!`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Payment Successful!</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Thank you for your purchase! 🎉</h2>
              <p>Your credit purchase has been processed successfully.</p>
              <div style="background: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 30px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; color: #666;">Credits Added:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981; font-size: 24px;">+${credits.toLocaleString()}</td>
                  </tr>
                  <tr style="border-top: 1px solid #d1fae5;">
                    <td style="padding: 10px 0; color: #666;">New Balance:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold; font-size: 20px;">${newBalance.toLocaleString()} credits</td>
                  </tr>
                </table>
              </div>
              <p>Your credits are ready to use. Enjoy AI-powered chat on your websites!</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Go to Dashboard</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Thank you for your purchase!\n\nCredits Added: +${credits.toLocaleString()}\nNew Balance: ${newBalance.toLocaleString()} credits\n\nYour credits are ready to use. Go to https://app.convitsa.com/dashboard`,
      });

      console.log(`✉️ Credits purchased email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send credits purchased email:', error);
    }
  }

  /**
   * Send low credits warning email
   */
  static async sendLowCreditsWarningEmail(to: string, balance: number): Promise<void> {
    try {
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: '⚠️ Your Convitsa Answer credits are running low',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Low Credit Balance</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Your credits are running low ⚠️</h2>
              <p>Your Convitsa Answer credit balance is getting low. To ensure uninterrupted AI chat service, consider adding more credits.</p>
              <div style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                <p style="color: #92400e; margin: 0 0 10px 0;">Current Balance</p>
                <span style="font-size: 36px; font-weight: bold; color: #f59e0b;">${balance.toLocaleString()}</span>
                <p style="color: #92400e; margin: 10px 0 0 0;">credits remaining</p>
              </div>
              <p>When your credits run out, Pro tier chat features will be unavailable until you add more.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://convitsa.gumroad.com" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Add Credits</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Your credits are running low!\n\nCurrent Balance: ${balance.toLocaleString()} credits\n\nTo ensure uninterrupted AI chat service, add more credits at https://convitsa.gumroad.com`,
      });

      console.log(`✉️ Low credits warning email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send low credits warning email:', error);
    }
  }

  /**
   * Send credits depleted email
   */
  static async sendCreditsDepletedEmail(to: string): Promise<void> {
    try {
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: '🚨 Your Convitsa Answer credits have run out',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Credits Depleted</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Your credit balance has reached zero 🚨</h2>
              <p>Your Convitsa Answer credits have been fully used. Pro tier chat features are now unavailable until you add more credits.</p>
              <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                <span style="font-size: 36px; font-weight: bold; color: #ef4444;">0</span>
                <p style="color: #991b1b; margin: 10px 0 0 0;">credits remaining</p>
              </div>
              <p>Your websites will now use the free tier with limited messages per session. Add credits to restore full functionality.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://convitsa.gumroad.com" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Add Credits Now</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Your credit balance has reached zero!\n\nPro tier chat features are now unavailable until you add more credits.\n\nAdd credits at https://convitsa.gumroad.com`,
      });

      console.log(`✉️ Credits depleted email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send credits depleted email:', error);
    }
  }

  /**
   * Send crawl completed email
   */
  static async sendCrawlCompletedEmail(to: string, projectName: string, pagesCount: number): Promise<void> {
    try {
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `✅ "${projectName}" crawl completed - ${pagesCount} pages indexed`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Crawl Complete!</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Your website has been indexed ✅</h2>
              <p>Great news! We've finished crawling your website and the AI is now ready to answer questions about it.</p>
              <div style="background: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 30px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; color: #666;">Project:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold;">${projectName}</td>
                  </tr>
                  <tr style="border-top: 1px solid #d1fae5;">
                    <td style="padding: 10px 0; color: #666;">Pages Indexed:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981; font-size: 20px;">${pagesCount}</td>
                  </tr>
                </table>
              </div>
              <p>Your AI chatbot can now answer questions based on your website content. Test it out!</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">View Project</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Your website has been indexed!\n\nProject: ${projectName}\nPages Indexed: ${pagesCount}\n\nYour AI chatbot can now answer questions based on your website content. Test it at https://app.convitsa.com/dashboard`,
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
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `❌ "${projectName}" crawl failed`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Crawl Failed</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">We couldn't crawl your website ❌</h2>
              <p>Unfortunately, we encountered an error while trying to crawl your website.</p>
              <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin: 30px 0;">
                <p style="color: #991b1b; margin: 0 0 10px 0; font-weight: bold;">Project: ${projectName}</p>
                <p style="color: #991b1b; margin: 0; font-size: 14px;">Error: ${errorMessage}</p>
              </div>
              <p><strong>Common fixes:</strong></p>
              <ul style="padding-left: 20px; color: #666;">
                <li>Make sure the website URL is correct and accessible</li>
                <li>Check if the website allows web crawlers</li>
                <li>Try again in a few minutes</li>
              </ul>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Try Again</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>Need help? Reply to this email or contact support.</p>
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `We couldn't crawl your website.\n\nProject: ${projectName}\nError: ${errorMessage}\n\nCommon fixes:\n- Make sure the website URL is correct and accessible\n- Check if the website allows web crawlers\n- Try again in a few minutes\n\nGo to https://app.convitsa.com/dashboard to retry`,
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
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `✅ "${fileName}" processed successfully`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Document Ready!</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Your document has been processed ✅</h2>
              <p>Great news! Your document has been processed and added to your AI's knowledge base.</p>
              <div style="background: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 30px 0;">
                <p style="color: #059669; margin: 0 0 10px 0;"><strong>File:</strong> ${fileName}</p>
                <p style="color: #059669; margin: 0;"><strong>Project:</strong> ${projectName}</p>
              </div>
              <p>Your AI chatbot can now answer questions based on this document's content.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">View Project</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `Your document has been processed!\n\nFile: ${fileName}\nProject: ${projectName}\n\nYour AI chatbot can now answer questions based on this document's content.\n\nGo to https://app.convitsa.com/dashboard`,
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
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `❌ "${fileName}" processing failed`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Processing Failed</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">We couldn't process your document ❌</h2>
              <p>Unfortunately, we encountered an error while processing your document.</p>
              <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin: 30px 0;">
                <p style="color: #991b1b; margin: 0 0 10px 0;"><strong>File:</strong> ${fileName}</p>
                <p style="color: #991b1b; margin: 0; font-size: 14px;"><strong>Error:</strong> ${errorMessage}</p>
              </div>
              <p><strong>Common fixes:</strong></p>
              <ul style="padding-left: 20px; color: #666;">
                <li>Make sure the file is not corrupted</li>
                <li>Try a different file format (PDF, DOCX, TXT)</li>
                <li>Check if the document contains readable text</li>
              </ul>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Upload Another File</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>Need help? Reply to this email or contact support.</p>
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `We couldn't process your document.\n\nFile: ${fileName}\nError: ${errorMessage}\n\nCommon fixes:\n- Make sure the file is not corrupted\n- Try a different file format (PDF, DOCX, TXT)\n- Check if the document contains readable text\n\nGo to https://app.convitsa.com/dashboard`,
      });

      console.log(`✉️ Document failed email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send document failed email:', error);
    }
  }

  /**
   * Send API key created email
   */
  static async sendApiKeyCreatedEmail(to: string, keyName: string, keyPrefix: string): Promise<void> {
    try {
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject: `🔑 New API key "${keyName}" created`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">API Key Created</h1>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">A new API key has been created 🔑</h2>
              <p>A new API key was created for your Convitsa Answer account.</p>
              <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 30px 0;">
                <p style="color: #666; margin: 0 0 10px 0;"><strong>Key Name:</strong> ${keyName}</p>
                <p style="color: #666; margin: 0;"><strong>Key Prefix:</strong> <code style="background: #e5e5e5; padding: 2px 6px; border-radius: 4px;">${keyPrefix}...</code></p>
              </div>
              <div style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="color: #92400e; margin: 0; font-size: 14px;"><strong>Security Notice:</strong> If you didn't create this API key, please secure your account immediately and revoke the key from your dashboard.</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.convitsa.com/dashboard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Manage API Keys</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Convitsa Answer. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `A new API key has been created for your Convitsa Answer account.\n\nKey Name: ${keyName}\nKey Prefix: ${keyPrefix}...\n\nSecurity Notice: If you didn't create this API key, please secure your account immediately.\n\nManage your API keys at https://app.convitsa.com/dashboard`,
      });

      console.log(`✉️ API key created email sent to ${to}`);
    } catch (error) {
      console.error('Failed to send API key created email:', error);
    }
  }
}


