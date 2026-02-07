// Export all schemas
export { User, type UserDocument } from './user.schema';
export { EmailVerification, type EmailVerificationDocument } from './email-verification.schema';
export { Project, type ProjectDocument } from './project.schema';
export { ApiKey, type ApiKeyDocument } from './api-key.schema';
export { Page, type PageDocument } from './page.schema';
export { ChatSession, type ChatSessionDocument } from './chat-session.schema';
export { ChatMessage, type ChatMessageDocument } from './chat-message.schema';
export { 
  CreditBalance, 
  CreditTransaction,
  type CreditBalanceDocument,
  type CreditTransactionDocument 
} from './credit-balance.schema';
export { DocumentModel, type DocumentDocument } from './document.schema';
export { DocumentChunk, type DocumentChunkDocument } from './document-chunk.schema';

// Subscription schema
export { Subscription, type SubscriptionDocument } from './subscription.schema';

// Marketing AI schemas
export { Lead, type LeadDocument } from './lead.schema';
export { ConversionEvent, type ConversionEventDocument } from './conversion-event.schema';
export { UnansweredQuestion, type UnansweredQuestionDocument } from './unanswered-question.schema';
export { LostLead, type LostLeadDocument } from './lost-lead.schema';

// Magic link schema
export { MagicLink, type MagicLinkDocument, type IMagicLink } from './magic-link.schema';

// Cancellation feedback schema
export { CancellationFeedback, type CancellationFeedbackDocument, type ICancellationFeedback, type CancellationReason } from './cancellation-feedback.schema';

// Feature request schema
export { FeatureRequest, type FeatureRequestDocument, type IFeatureRequest } from './feature-request.schema';