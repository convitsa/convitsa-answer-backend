/**
 * Webhook notification service for CRM integrations
 */
export interface LeadWebhookPayload {
  leadId: string;
  projectId: string;
  email?: string;
  phone?: string;
  name?: string;
  company?: string;
  source: string;
  capturedAt: Date;
}

export interface UnansweredQuestionWebhookPayload {
  questionId: string;
  projectId: string;
  question: string;
  aiResponse?: string;
  createdAt: Date;
}

export class WebhookService {
  private static readonly TIMEOUT_MS = 10000; // 10 second timeout
  private static readonly MAX_RETRIES = 2;

  /**
   * Send a webhook for a new lead
   */
  static async sendLeadWebhook(
    webhookUrl: string,
    payload: LeadWebhookPayload
  ): Promise<boolean> {
    return this.sendWebhook(webhookUrl, {
      event: 'lead.captured',
      timestamp: new Date().toISOString(),
      data: payload,
    });
  }

  /**
   * Send a webhook for an unanswered question
   */
  static async sendUnansweredQuestionWebhook(
    webhookUrl: string,
    payload: UnansweredQuestionWebhookPayload
  ): Promise<boolean> {
    return this.sendWebhook(webhookUrl, {
      event: 'question.unanswered',
      timestamp: new Date().toISOString(),
      data: payload,
    });
  }

  /**
   * Generic webhook sender with retry logic
   */
  private static async sendWebhook(
    url: string,
    payload: any,
    retries: number = 0
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Convitsa-Answer-Webhook/1.0',
          'X-Webhook-Event': payload.event,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`✅ Webhook sent successfully to ${url}`);
        return true;
      }

      console.error(`❌ Webhook failed: ${response.status} ${response.statusText}`);
      
      // Retry on server errors
      if (response.status >= 500 && retries < this.MAX_RETRIES) {
        console.log(`🔄 Retrying webhook (attempt ${retries + 2}/${this.MAX_RETRIES + 1})`);
        await this.delay(1000 * (retries + 1)); // Exponential backoff
        return this.sendWebhook(url, payload, retries + 1);
      }

      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Webhook error: ${errorMessage}`);

      // Retry on network errors
      if (retries < this.MAX_RETRIES) {
        console.log(`🔄 Retrying webhook (attempt ${retries + 2}/${this.MAX_RETRIES + 1})`);
        await this.delay(1000 * (retries + 1));
        return this.sendWebhook(url, payload, retries + 1);
      }

      return false;
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
