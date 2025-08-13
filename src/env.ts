import { z } from 'zod';

const envSchema = z.object({
  // Basic service configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)).default('3000'),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // External service configurations - all required
  MEMORY_BASE_URL: z.string().url({
    message: 'MEMORY_BASE_URL must be a valid URL'
  }),
  MEMORY_TOKEN: z.string().min(1, {
    message: 'MEMORY_TOKEN is required and cannot be empty'
  }),
  NOTION_BASE_URL: z.string().url({
    message: 'NOTION_BASE_URL must be a valid URL'
  }),
  NOTION_TOKEN: z.string().min(1, {
    message: 'NOTION_TOKEN is required and cannot be empty'
  }),
  BRAVE_API_KEY: z.string().min(1, {
    message: 'BRAVE_API_KEY is required and cannot be empty'
  }),
  MONGO_URL: z.string().url({
    message: 'MONGO_URL must be a valid MongoDB connection string'
  }),
  EMBEDDINGS_PROVIDER: z.enum(['openai', 'cohere', 'huggingface', 'local'], {
    errorMap: () => ({ message: 'EMBEDDINGS_PROVIDER must be one of: openai, cohere, huggingface, local' })
  }),
  ALLOW_PRIVATE_DEFAULT: z.string()
    .transform((val) => val.toLowerCase() === 'true')
    .pipe(z.boolean())
    .default('false')
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      console.error('');
      
      const missingRequired = error.errors.filter(err => 
        err.code === 'invalid_type' && err.received === 'undefined'
      );
      
      const invalidValues = error.errors.filter(err => 
        err.code !== 'invalid_type' || err.received !== 'undefined'
      );
      
      if (missingRequired.length > 0) {
        console.error('Missing required environment variables:');
        missingRequired.forEach(err => {
          console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
        console.error('');
      }
      
      if (invalidValues.length > 0) {
        console.error('Invalid environment variable values:');
        invalidValues.forEach(err => {
          console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
        console.error('');
      }
      
      console.error('Please check your environment variables and try again.');
      console.error('See .env.example for the required format.');
      
      process.exit(1);
    }
    
    throw error;
  }
}