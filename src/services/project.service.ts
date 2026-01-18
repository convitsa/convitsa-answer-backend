import { Types } from 'mongoose';
import { Project, ApiKey, Page, ChatSession, ChatMessage, User } from '../db/schemas';
import type { IProject, IApiKey, ServiceResult, CrawlStatus, MarketingConfig } from '../types';
import { generateApiKey, hashSHA256, isValidUrl } from '../utils/helpers';
import { EmailService } from './email.service';

export interface CreateProjectInput {
  name: string;
  websiteUrl: string;
}

export interface UpdateProjectInput {
  name?: string;
  websiteUrl?: string;
  marketingConfig?: Partial<MarketingConfig>;
}

export interface ProjectWithStats extends Omit<IProject, '_id'> {
  _id: string;
  pagesCount: number;
  apiKeysCount: number;
  sessionsCount: number;
}

export class ProjectService {
  /**
   * Create a new project
   */
  static async createProject(
    userId: string,
    input: CreateProjectInput
  ): Promise<ServiceResult<IProject>> {
    try {
      if (!isValidUrl(input.websiteUrl)) {
        return {
          success: false,
          error: 'Invalid website URL',
          code: 'INVALID_URL',
        };
      }

      const project = await Project.create({
        userId: new Types.ObjectId(userId),
        name: input.name.trim(),
        websiteUrl: input.websiteUrl.trim(),
        crawlStatus: 'idle' as CrawlStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return {
        success: true,
        data: project.toObject() as IProject,
      };
    } catch (error) {
      console.error('Create project error:', error);
      return {
        success: false,
        error: 'Failed to create project',
        code: 'CREATE_FAILED',
      };
    }
  }

  /**
   * Get all projects for a user
   */
  static async getProjects(userId: string): Promise<ServiceResult<ProjectWithStats[]>> {
    try {
      const projects = await Project.find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .lean();

      // Get stats for each project
      const projectsWithStats = await Promise.all(
        projects.map(async (project) => {
          const [pagesCount, apiKeysCount, sessionsCount] = await Promise.all([
            Page.countDocuments({ projectId: project._id }),
            ApiKey.countDocuments({ projectId: project._id, active: true }),
            ChatSession.countDocuments({ projectId: project._id }),
          ]);

          return {
            ...project,
            _id: project._id.toString(),
            pagesCount,
            apiKeysCount,
            sessionsCount,
          } as ProjectWithStats;
        })
      );

      return {
        success: true,
        data: projectsWithStats,
      };
    } catch (error) {
      console.error('Get projects error:', error);
      return {
        success: false,
        error: 'Failed to get projects',
        code: 'FETCH_FAILED',
      };
    }
  }

  /**
   * Get a single project by ID
   */
  static async getProject(userId: string, projectId: string): Promise<ServiceResult<ProjectWithStats>> {
    try {
      const project = await Project.findOne({
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(userId),
      }).lean();

      if (!project) {
        return {
          success: false,
          error: 'Project not found',
          code: 'NOT_FOUND',
        };
      }

      const [pagesCount, apiKeysCount, sessionsCount] = await Promise.all([
        Page.countDocuments({ projectId: project._id }),
        ApiKey.countDocuments({ projectId: project._id, active: true }),
        ChatSession.countDocuments({ projectId: project._id }),
      ]);

      return {
        success: true,
        data: {
          ...project,
          _id: project._id.toString(),
          pagesCount,
          apiKeysCount,
          sessionsCount,
        } as ProjectWithStats,
      };
    } catch (error) {
      console.error('Get project error:', error);
      return {
        success: false,
        error: 'Failed to get project',
        code: 'FETCH_FAILED',
      };
    }
  }

  /**
   * Update a project
   */
  static async updateProject(
    userId: string,
    projectId: string,
    input: UpdateProjectInput
  ): Promise<ServiceResult<IProject>> {
    try {
      if (input.websiteUrl && !isValidUrl(input.websiteUrl)) {
        return {
          success: false,
          error: 'Invalid website URL',
          code: 'INVALID_URL',
        };
      }

      const updateData: Record<string, any> = {};
      if (input.name) updateData.name = input.name.trim();
      if (input.websiteUrl) updateData.websiteUrl = input.websiteUrl.trim();
      
      // Handle marketingConfig update (merge with existing)
      if (input.marketingConfig) {
        const existingProject = await Project.findOne({
          _id: new Types.ObjectId(projectId),
          userId: new Types.ObjectId(userId),
        }).lean();

        if (!existingProject) {
          return {
            success: false,
            error: 'Project not found',
            code: 'NOT_FOUND',
          };
        }

        // Merge existing config with new config
        const existingConfig = (existingProject.marketingConfig as MarketingConfig) || {};
        updateData.marketingConfig = {
          ...existingConfig,
          ...input.marketingConfig,
          // Deep merge contactOptions if provided
          contactOptions: input.marketingConfig.contactOptions 
            ? { ...existingConfig.contactOptions, ...input.marketingConfig.contactOptions }
            : existingConfig.contactOptions,
        };
      }

      const project = await Project.findOneAndUpdate(
        {
          _id: new Types.ObjectId(projectId),
          userId: new Types.ObjectId(userId),
        },
        { $set: updateData },
        { new: true }
      ).lean();

      if (!project) {
        return {
          success: false,
          error: 'Project not found',
          code: 'NOT_FOUND',
        };
      }

      return {
        success: true,
        data: project as IProject,
      };
    } catch (error) {
      console.error('Update project error:', error);
      return {
        success: false,
        error: 'Failed to update project',
        code: 'UPDATE_FAILED',
      };
    }
  }

  /**
   * Delete a project and all associated data
   */
  static async deleteProject(userId: string, projectId: string): Promise<ServiceResult<void>> {
    try {
      const project = await Project.findOne({
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(userId),
      });

      if (!project) {
        return {
          success: false,
          error: 'Project not found',
          code: 'NOT_FOUND',
        };
      }

      // Delete all associated data
      const projectObjId = new Types.ObjectId(projectId);

      // Get all session IDs for this project
      const sessions = await ChatSession.find({ projectId: projectObjId }).select('_id').lean();
      const sessionIds = sessions.map((s) => s._id);

      // Delete in order
      await Promise.all([
        ChatMessage.deleteMany({ sessionId: { $in: sessionIds } }),
        ChatSession.deleteMany({ projectId: projectObjId }),
        Page.deleteMany({ projectId: projectObjId }),
        ApiKey.deleteMany({ projectId: projectObjId }),
      ]);

      // Finally delete the project
      await Project.deleteOne({ _id: projectObjId });

      return { success: true };
    } catch (error) {
      console.error('Delete project error:', error);
      return {
        success: false,
        error: 'Failed to delete project',
        code: 'DELETE_FAILED',
      };
    }
  }

  /**
   * Update crawl status
   */
  static async updateCrawlStatus(
    projectId: string,
    status: CrawlStatus,
    error?: string
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      crawlStatus: status,
      updatedAt: new Date(),
    };

    if (status === 'completed') {
      updateData.lastCrawledAt = new Date();
      updateData.crawlError = undefined;
    }

    if (error) {
      updateData.crawlError = error;
    }

    await Project.updateOne(
      { _id: new Types.ObjectId(projectId) },
      { $set: updateData }
    );
  }

  /**
   * Get pages for a project
   */
  static async getPages(
    userId: string,
    projectId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ServiceResult<{ pages: Array<{ url: string; title: string; crawledAt: Date }>; total: number }>> {
    try {
      // Verify ownership
      const project = await Project.findOne({
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(userId),
      });

      if (!project) {
        return {
          success: false,
          error: 'Project not found',
          code: 'NOT_FOUND',
        };
      }

      const skip = (page - 1) * limit;
      const projectObjId = new Types.ObjectId(projectId);

      const [pages, total] = await Promise.all([
        Page.find({ projectId: projectObjId })
          .select('url title crawledAt')
          .sort({ crawledAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Page.countDocuments({ projectId: projectObjId }),
      ]);

      // Group by URL (since we have chunks)
      const uniquePages = pages.reduce((acc, page) => {
        if (!acc.find((p) => p.url === page.url)) {
          acc.push({
            url: page.url,
            title: page.title,
            crawledAt: page.crawledAt,
          });
        }
        return acc;
      }, [] as Array<{ url: string; title: string; crawledAt: Date }>);

      return {
        success: true,
        data: { pages: uniquePages, total },
      };
    } catch (error) {
      console.error('Get pages error:', error);
      return {
        success: false,
        error: 'Failed to get pages',
        code: 'FETCH_FAILED',
      };
    }
  }
}

// API Key Service
export class ApiKeyService {
  /**
   * Create a new API key for a project
   */
  static async createApiKey(
    userId: string,
    projectId: string,
    name: string = 'Default Key'
  ): Promise<ServiceResult<{ apiKey: string; keyPrefix: string; id: string }>> {
    try {
      // Verify project ownership
      const project = await Project.findOne({
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(userId),
      });

      if (!project) {
        return {
          success: false,
          error: 'Project not found',
          code: 'NOT_FOUND',
        };
      }

      // Generate API key
      const { fullKey, prefix, keyHash } = generateApiKey();

      const apiKey = await ApiKey.create({
        keyHash,
        keyPrefix: prefix,
        userId: new Types.ObjectId(userId),
        projectId: new Types.ObjectId(projectId),
        name: name.trim(),
        active: true,
        createdAt: new Date(),
      });

      // Send API key created email (non-blocking)
      (async () => {
        try {
          const user = await User.findById(userId).select('email').lean();
          if (user?.email) {
            await EmailService.sendApiKeyCreatedEmail(user.email, name.trim(), prefix);
            console.log(`✉️ Sent API key created email to ${user.email}`);
          }
        } catch (err) {
          console.error('Failed to send API key created email:', err);
        }
      })();

      return {
        success: true,
        data: {
          apiKey: fullKey, // Only returned once!
          keyPrefix: prefix,
          id: apiKey._id.toString(),
        },
      };
    } catch (error) {
      console.error('Create API key error:', error);
      return {
        success: false,
        error: 'Failed to create API key',
        code: 'CREATE_FAILED',
      };
    }
  }

  /**
   * Get all API keys for a project
   */
  static async getApiKeys(
    userId: string,
    projectId: string
  ): Promise<ServiceResult<Array<{ id: string; keyPrefix: string; name: string; active: boolean; createdAt: Date }>>> {
    try {
      // Verify project ownership
      const project = await Project.findOne({
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(userId),
      });

      if (!project) {
        return {
          success: false,
          error: 'Project not found',
          code: 'NOT_FOUND',
        };
      }

      const apiKeys = await ApiKey.find({ projectId: new Types.ObjectId(projectId) })
        .select('keyPrefix name active createdAt')
        .sort({ createdAt: -1 })
        .lean();

      return {
        success: true,
        data: apiKeys.map((key) => ({
          id: key._id.toString(),
          keyPrefix: key.keyPrefix,
          name: key.name,
          active: key.active,
          createdAt: key.createdAt,
        })),
      };
    } catch (error) {
      console.error('Get API keys error:', error);
      return {
        success: false,
        error: 'Failed to get API keys',
        code: 'FETCH_FAILED',
      };
    }
  }

  /**
   * Revoke (deactivate) an API key
   */
  static async revokeApiKey(userId: string, keyId: string): Promise<ServiceResult<void>> {
    try {
      const apiKey = await ApiKey.findOne({
        _id: new Types.ObjectId(keyId),
        userId: new Types.ObjectId(userId),
      });

      if (!apiKey) {
        return {
          success: false,
          error: 'API key not found',
          code: 'NOT_FOUND',
        };
      }

      apiKey.active = false;
      await apiKey.save();

      return { success: true };
    } catch (error) {
      console.error('Revoke API key error:', error);
      return {
        success: false,
        error: 'Failed to revoke API key',
        code: 'REVOKE_FAILED',
      };
    }
  }

  /**
   * Validate an API key and return associated data
   */
  static async validateApiKey(
    fullKey: string
  ): Promise<ServiceResult<{ apiKeyId: Types.ObjectId; projectId: Types.ObjectId; userId: Types.ObjectId }>> {
    try {
      const keyHash = hashSHA256(fullKey);

      const apiKey = await ApiKey.findOne({ keyHash, active: true }).lean();

      if (!apiKey) {
        return {
          success: false,
          error: 'Invalid or inactive API key',
          code: 'INVALID_KEY',
        };
      }

      return {
        success: true,
        data: {
          apiKeyId: apiKey._id as Types.ObjectId,
          projectId: apiKey.projectId as Types.ObjectId,
          userId: apiKey.userId as Types.ObjectId,
        },
      };
    } catch (error) {
      console.error('Validate API key error:', error);
      return {
        success: false,
        error: 'Key validation failed',
        code: 'VALIDATION_FAILED',
      };
    }
  }
}


