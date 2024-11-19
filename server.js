const express = require('express')
const helmet = require('helmet')
const mongoSanitize = require('express-mongo-sanitize')
const xss = require('xss-clean')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const hpp = require('hpp')
const compression = require('compression')
const winston = require('winston')
const { v4: uuidv4 } = require('uuid')
const mongoose = require('mongoose')
const connectDB = require('./utils/db')
require('dotenv').config()

const app = express()

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  )
}

// Logging utility for sanitizing sensitive data
const sanitizeData = (data) => {
  if (!data) return data

  const sensitiveFields = ['password', 'token', 'authorization', 'cookie', 'jwt', 'sessionId', 'creditCard', 'cardNumber', 'cvv', 'ssn', 'email', 'phone', 'address']

  return Object.keys(data).reduce((acc, key) => {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      acc[key] = '[REDACTED]'
    } else if (typeof data[key] === 'object') {
      acc[key] = sanitizeData(data[key])
    } else {
      acc[key] = data[key]
    }
    return acc
  }, {})
}

// Security middleware
app.use(helmet())
app.use(mongoSanitize())
app.use(xss())
app.use(
  hpp({
    whitelist: ['price', 'rating', 'category', 'sort'],
  })
)

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
})

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
})

app.use(limiter)

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-store-id', 'x-correlation-id'],
  exposedHeaders: ['X-Total-Count', 'X-Total-Pages'],
  credentials: true,
  maxAge: 86400,
}
app.use(cors(corsOptions))

// Request parsing and compression
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true, limit: '10kb' }))
app.use(compression())

// Correlation ID middleware
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4()
  res.setHeader('x-correlation-id', req.correlationId)
  next()
})

// Secure request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now()

  // Sanitize request data before logging
  const sanitizedReq = {
    method: req.method,
    url: req.url.replace(/token=[^&]+/, 'token=[REDACTED]'),
    query: sanitizeData(req.query),
    params: sanitizeData(req.params),
    headers: sanitizeData({
      ...req.headers,
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
    }),
  }

  res.on('finish', () => {
    const duration = Date.now() - startTime
    logger.info('Request processed', {
      correlationId: req.correlationId,
      ...sanitizedReq,
      status: res.statusCode,
      duration,
      ip: req.headers['x-forwarded-for'] || req.ip,
      userAgent: req.get('user-agent'),
    })
  })

  next()
})

// Routes
app.use('/api/auth', authLimiter, require('./routes/authRoutes'))
app.use('/api/stores', require('./routes/storeRoutes'))
// app.use('/api/categories', require('./routes/categoryRoutes'))
// app.use('/api/products', require('./routes/productRoutes'))
// app.use('/api/orders', require('./routes/orderRoutes'))



app.get('/health', (_, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Resource not found',
    correlationId: req.correlationId,
  })
})

// Secure error handler
app.use((err, req, res, next) => {
  const sanitizedError = {
    name: err.name,
    message: err.message,
    status: err.status || 500,
    path: req.url.replace(/token=[^&]+/, 'token=[REDACTED]'),
  }

  if (err.data) {
    sanitizedError.data = sanitizeData(err.data)
  }

  logger.error('Error occurred', {
    correlationId: req.correlationId,
    error: sanitizedError,
    request: {
      method: req.method,
      url: req.url.replace(/token=[^&]+/, 'token=[REDACTED]'),
    },
  })

  res.status(sanitizedError.status).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : sanitizedError.message,
    correlationId: req.correlationId,
  })
})

// Graceful shutdown handler
const shutdown = async () => {
  logger.info('Shutting down server...')

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close()
      logger.info('Database connection closed')
    }

    if (server) {
      server.close(() => {
        logger.info('HTTP server closed')
        process.exit(0)
      })

      setTimeout(() => {
        logger.error('Forced shutdown after timeout')
        process.exit(1)
      }, 30000)
    }
  } catch (err) {
    const sanitizedError = {
      name: err.name,
      message: err.message,
    }
    logger.error('Error during shutdown:', sanitizedError)
    process.exit(1)
  }
}

// Process error handlers with sanitized logging
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

process.on('uncaughtException', (err) => {
  const sanitizedError = {
    name: err.name,
    message: err.message,
  }
  logger.error('Uncaught exception:', sanitizedError)
  shutdown()
})

process.on('unhandledRejection', (err) => {
  const sanitizedError = {
    name: err.name,
    message: err.message,
  }
  logger.error('Unhandled rejection:', sanitizedError)
  shutdown()
})

// Server initialization
const PORT = process.env.PORT || 5000
let server

const startServer = async () => {
  try {
    await connectDB()
    logger.info('Database connected')

    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`)
    })

    server.keepAliveTimeout = 65000
    server.headersTimeout = 66000
  } catch (err) {
    const sanitizedError = {
      name: err.name,
      message: err.message,
    }
    logger.error('Server startup failed:', sanitizedError)
    process.exit(1)
  }
}

startServer()

module.exports = app
