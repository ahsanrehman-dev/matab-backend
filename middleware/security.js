// Simple rate limiting implementation
const rateLimitStore = new Map();

export const createRateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const windowStart = now - windowMs;

        // Clean old entries
        if (rateLimitStore.has(key)) {
            const requests = rateLimitStore.get(key);
            const validRequests = requests.filter(time => time > windowStart);
            rateLimitStore.set(key, validRequests);

            if (validRequests.length >= max) {
                return res.status(429).json({
                    success: false,
                    error: 'Too many requests from this IP, please try again later.'
                });
            }

            validRequests.push(now);
            rateLimitStore.set(key, validRequests);
        } else {
            rateLimitStore.set(key, [now]);
        }

        next();
    };
};

// Auth rate limiting (stricter for login/register)
export const authRateLimit = createRateLimit(15 * 60 * 1000, 5); // 5 attempts per 15 minutes

// API rate limiting
export const apiRateLimit = createRateLimit(15 * 60 * 1000, 100); // 100 requests per 15 minutes

// Security headers middleware
export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
};

// XSS protection
export const xssProtection = (req, res, next) => {
    // Simple XSS protection by sanitizing common dangerous patterns
    const sanitize = (obj) => {
        if (typeof obj === 'string') {
            return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+\s*=/gi, '');
        }
        if (typeof obj === 'object' && obj !== null) {
            for (let key in obj) {
                obj[key] = sanitize(obj[key]);
            }
        }
        return obj;
    };

    req.body = sanitize(req.body);
    req.query = sanitize(req.query);
    req.params = sanitize(req.params);
    next();
};

// NoSQL injection protection
export const mongoSanitization = (req, res, next) => {
    const sanitize = (obj) => {
        if (Array.isArray(obj)) {
            return obj.map(sanitize);
        }
        if (typeof obj === 'object' && obj !== null) {
            const clean = {};
            for (const key of Object.keys(obj)) {
                if (key.startsWith('$') || key.includes('.')) {
                    continue;
                }
                clean[key] = sanitize(obj[key]);
            }
            return clean;
        }
        return obj;
    };

    if (req.body) req.body = sanitize(req.body);
    if (req.query) req.query = sanitize(req.query);
    if (req.params) req.params = sanitize(req.params);
    next();
};

// Input validation middleware
export const validateInput = (rules) => {
    return (req, res, next) => {
        const errors = [];

        for (const rule of rules) {
            const { field, value, validators } = rule;
            const fieldValue = getNestedValue(req, field);

            for (const validator of validators) {
                const result = validator(fieldValue);
                if (result !== true) {
                    errors.push({
                        field,
                        message: result
                    });
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors
            });
        }

        next();
    };
};

// Helper function to get nested values from req object
const getNestedValue = (obj, path) => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
};

// Common validation functions
export const validators = {
    required: (value) => {
        if (value === undefined || value === null || value === '') {
            return 'This field is required';
        }
        return true;
    },

    email: (value) => {
        if (!value) return true; // Skip if not required
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value) ? true : 'Please provide a valid email';
    },

    minLength: (min) => (value) => {
        if (!value) return true;
        return value.length >= min ? true : `Must be at least ${min} characters long`;
    },

    maxLength: (max) => (value) => {
        if (!value) return true;
        return value.length <= max ? true : `Must be no more than ${max} characters long`;
    },

    username: (value) => {
        if (!value) return true;
        const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
        return usernameRegex.test(value) ? true : 'Username must be 3-30 characters and contain only letters, numbers, and underscores';
    },

    positiveNumber: (value) => {
        if (value === undefined || value === null) return true;
        const num = parseFloat(value);
        return !isNaN(num) && num > 0 ? true : 'Must be a positive number';
    },

    nonNegativeNumber: (value) => {
        if (value === undefined || value === null) return true;
        const num = parseFloat(value);
        return !isNaN(num) && num >= 0 ? true : 'Must be a non-negative number';
    },

    mongoId: (value) => {
        if (!value) return true;
        const mongoIdRegex = /^[0-9a-fA-F]{24}$/;
        return mongoIdRegex.test(value) ? true : 'Invalid ID format';
    }
};

// Common validation rules
export const validationRules = {
    email: {
        field: 'body.email',
        validators: [validators.required, validators.email]
    },

    password: {
        field: 'body.password',
        validators: [validators.required, validators.minLength(6)]
    },

    username: {
        field: 'body.username',
        validators: [validators.required, validators.username]
    },

    productId: {
        field: 'params.id',
        validators: [validators.required, validators.mongoId]
    },

    price: {
        field: 'body.price',
        validators: [validators.required, validators.positiveNumber]
    },

    quantity: {
        field: 'body.quantity',
        validators: [validators.required, validators.nonNegativeNumber]
    }
};
