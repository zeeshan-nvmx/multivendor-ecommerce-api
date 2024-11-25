const express = require('express')
const helmet = require('helmet')
const mongoSanitize = require('express-mongo-sanitize')
const xss = require('xss-clean')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const hpp = require('hpp')
const compression = require('compression')
const { v4: uuidv4 } = require('uuid')
const mongoose = require('mongoose')
const connectDB = require('./utils/db')
require('dotenv').config()

// const client = require('prom-client')
// const collectDefaultMetrics = client.collectDefaultMetrics
// const Registry = client.Registry
// const register = new Registry()
// collectDefaultMetrics({ register })

// const httpRequestDurationMicroseconds = new client.Histogram({
//   name: 'http_request_duration_seconds',
//   help: 'Duration of HTTP requests in seconds',
//   labelNames: ['method', 'route', 'code'],
//   buckets: [0.1, 0.5, 1, 1.5, 2, 3, 4, 5]
// })
// register.registerMetric(httpRequestDurationMicroseconds)

// const httpRequestCounter = new client.Counter({
//   name: 'http_requests_total',
//   help: 'Total number of HTTP requests',
//   labelNames: ['method', 'route', 'code']
// })
// register.registerMetric(httpRequestCounter)

const app = express()

const metrics = {
  requestCount: 0,
  errorCount: 0,
  requestDurations: {},
  requestsByEndpoint: {},
  errorsByType: {},
  requestsByMethod: {},
  requestsByStatusCode: {},
  activeConnections: 0,
  lastMetricsReset: Date.now(),
}

const MetricsUtil = {
  incrementRequestCount: (endpoint, method, statusCode) => {
    metrics.requestCount++
    metrics.requestsByEndpoint[endpoint] = (metrics.requestsByEndpoint[endpoint] || 0) + 1
    metrics.requestsByMethod[method] = (metrics.requestsByMethod[method] || 0) + 1
    metrics.requestsByStatusCode[statusCode] = (metrics.requestsByStatusCode[statusCode] || 0) + 1
    metrics.activeConnections++
  },
  decrementConnections: () => {
    metrics.activeConnections = Math.max(0, metrics.activeConnections - 1)
  },
  recordDuration: (endpoint, duration) => {
    if (!metrics.requestDurations[endpoint]) {
      metrics.requestDurations[endpoint] = {
        total: 0,
        count: 0,
        max: 0,
        min: Infinity,
      }
    }
    const stat = metrics.requestDurations[endpoint]
    stat.total += duration
    stat.count++
    stat.max = Math.max(stat.max, duration)
    stat.min = Math.min(stat.min, duration)
  },
  recordError: (type) => {
    metrics.errorCount++
    metrics.errorsByType[type] = (metrics.errorsByType[type] || 0) + 1
  },
  getMetrics: () => ({
    ...metrics,
    requestDurations: Object.entries(metrics.requestDurations).reduce((acc, [key, stat]) => {
      acc[key] = {
        ...stat,
        average: stat.count > 0 ? stat.total / stat.count : 0,
      }
      return acc
    }, {}),
  }),
  resetMetrics: () => {
    Object.keys(metrics).forEach((key) => {
      if (typeof metrics[key] === 'number') metrics[key] = 0
      if (typeof metrics[key] === 'object') metrics[key] = {}
    })
    metrics.lastMetricsReset = Date.now()
  },
}

const logger = {
  formatMessage: (level, message, meta = {}) => {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      service: 'multivendor-api',
      environment: process.env.NODE_ENV,
      ...meta,
      metrics: undefined,
      stack: meta.error?.stack,
    })
  },
  info: (message, meta = {}) => {
    console.log(logger.formatMessage('info', message, meta))
  },
  error: (message, meta = {}) => {
    console.error(
      logger.formatMessage('error', message, {
        ...meta,
        error_type: meta.error?.name || 'UnknownError',
      })
    )
    if (meta.error) MetricsUtil.recordError(meta.error.name || 'UnknownError')
  },
  warn: (message, meta = {}) => {
    console.warn(logger.formatMessage('warn', message, meta))
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(logger.formatMessage('debug', message, meta))
    }
  },
}

const sanitizeData = (data) => {
  if (!data) return data
  if (Array.isArray(data)) return data.map(sanitizeData)
  if (typeof data !== 'object') return data

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

app.use(helmet())
app.use(mongoSanitize())
app.use(xss())
app.use(
  hpp({
    whitelist: ['price', 'rating', 'category', 'sort'],
  })
)

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

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-store-id', 'x-correlation-id'],
  exposedHeaders: ['X-Total-Count', 'X-Total-Pages'],
  credentials: true,
  maxAge: 86400,
}
app.use(cors(corsOptions))

app.use(express.urlencoded({ extended: true })) 
app.use(express.json())
app.use(compression())

// app.use((req, res, next) => {
//   req.correlationId = req.headers['x-correlation-id'] || uuidv4()
//   res.setHeader('x-correlation-id', req.correlationId)
//   next()
// })

app.use((req, res, next) => {
  const startTime = Date.now()
  const requestId = uuidv4()
  const endpoint = req.originalUrl.split('?')[0]

  MetricsUtil.incrementRequestCount(endpoint, req.method, res.statusCode)

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
    MetricsUtil.recordDuration(endpoint, duration)
    MetricsUtil.decrementConnections()

    logger.info('Request processed', {
      request_id: requestId,
      correlationId: req.correlationId,
      ...sanitizedReq,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.headers['x-forwarded-for'] || req.ip,
      userAgent: req.get('user-agent'),
      endpoint,
      method: req.method,
    })
  })

  next()
})

// app.get('/metrics', async (_, res) => {
//   try {
//     res.set('Content-Type', register.contentType)
//     res.end(await register.metrics())
//   } catch (err) {
//     res.status(500).end(err)
//   }
// })

app.get('/metrics', (_, res) => {
  res.json(MetricsUtil.getMetrics())
})

app.use('/api/auth', authLimiter, require('./routes/authRoutes'))
app.use('/api/stores', require('./routes/storeRoutes'))
app.use('/api/categories', require('./routes/categoryRoutes'))
app.use('/api/products', require('./routes/productRoutes'))
// app.use('/api/orders', require('./routes/orderRoutes'))

app.get('/health', (_, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    metrics: MetricsUtil.getMetrics(),
  }
  res.status(200).json(healthData)
})

app.use((req, res) => {
  MetricsUtil.recordError('NotFound')
  res.status(404).json({
    message: 'Resource not found',
    correlationId: req.correlationId,
  })
})

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
      url: sanitizedError.path,
    },
  })

  res.status(sanitizedError.status).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : sanitizedError.message,
    correlationId: req.correlationId,
  })
})

const shutdown = async () => {
  logger.info('Shutting down server...', {
    uptime: process.uptime(),
    metrics: MetricsUtil.getMetrics(),
  })

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close()
      logger.info('Database connection closed')
    }

    if (server) {
      server.close(() => {
        logger.info('HTTP server closed', {
          metrics: MetricsUtil.getMetrics(),
        })
        process.exit(0)
      })

      setTimeout(() => {
        logger.error('Forced shutdown after timeout')
        process.exit(1)
      }, 30000)
    }
  } catch (err) {
    logger.error('Error during shutdown:', { error: err })
    process.exit(1)
  }
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', {
    error: err,
    error_type: 'uncaught_exception',
  })
  shutdown()
})

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', {
    error: err,
    error_type: 'unhandled_rejection',
  })
  shutdown()
})

const PORT = process.env.PORT || 5000
let server

const startServer = async () => {
  try {
    await connectDB()
    logger.info('Database connected', {
      mongodb_version: mongoose.version,
      connection_string: process.env.MONGO_URI?.replace(/mongodb\+srv:\/\/([^:]+):([^@]+)@/, 'mongodb+srv://[REDACTED]:[REDACTED]@'),
    })

    server = app.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        node_version: process.version,
        environment: process.env.NODE_ENV,
      })
    })

    server.keepAliveTimeout = 65000
    server.headersTimeout = 66000

    setInterval(() => {
      if (Date.now() - metrics.lastMetricsReset > 24 * 60 * 60 * 1000) {
        MetricsUtil.resetMetrics()
      }
    }, 60 * 60 * 1000)
  } catch (err) {
    logger.error('Server startup failed:', { error: err })
    process.exit(1)
  }
}

startServer()

module.exports = app
