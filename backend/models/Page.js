const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema(
  {
    pageName: {
      type: String,
      required: [true, 'Page Name is required'],
      unique: true,
      trim: true,
    },
    pagePath: {
      type: String,
      required: [true, 'Page Path is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    iconName: {
      type: String,
      default: '',
    },
    order: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  {
    collection: 'pages',
    timestamps: true,
  }
);

// Pre-defined default system pages stored in MongoDB
const DEFAULT_PAGES = [
  { pageName: 'Dashboard', pagePath: '/dashboard', iconName: 'LayoutDashboard', order: 1, description: 'Live plant summary and vehicle overview' },
  { pageName: 'Plant', pagePath: '/plants', iconName: 'Building2', order: 2, description: 'Plant configuration and geofence management' },
  { pageName: 'Vehicle Register', pagePath: '/vehicles', iconName: 'Truck', order: 3, description: 'Fleet vehicle registration and master records' },
  { pageName: 'Driver Registry', pagePath: '/drivers', iconName: 'UserCheck', order: 4, description: 'Driver registry, photos and telematics tracking' },
  { pageName: 'GPS', pagePath: '/gps', iconName: 'Navigation', order: 5, description: 'Real-time GPS telematics and live tracking' },
  { pageName: 'Report', pagePath: '/reports', iconName: 'FileSpreadsheet', order: 6, description: 'Stay hours and movement reports for fleet and drivers' },
  { pageName: 'User Management', pagePath: '/users', iconName: 'Users', order: 7, description: 'User roles, credentials and page access authorization' },
  { pageName: 'Sikka AI', pagePath: '/sikka-ai', iconName: 'Sparkles', order: 8, description: 'Sikka AI intelligence module, 30-min auto sync, stay analytics and diagnostics' },
];

/**
 * Ensures all system pages exist in MongoDB.
 * Inserts any missing pages automatically on startup.
 */
pageSchema.statics.ensureDefaultPages = async function () {
  try {
    for (const defPage of DEFAULT_PAGES) {
      await this.findOneAndUpdate(
        { pageName: defPage.pageName },
        {
          $setOnInsert: {
            pageName: defPage.pageName,
            pagePath: defPage.pagePath,
            iconName: defPage.iconName,
            order: defPage.order,
            description: defPage.description,
            status: 'Active',
          },
        },
        { upsert: true, returnDocument: 'after' }
      );
    }
  } catch (err) {
    console.error('[Page Model ensureDefaultPages Error]:', err.message);
  }
};

module.exports = mongoose.model('Page', pageSchema);
