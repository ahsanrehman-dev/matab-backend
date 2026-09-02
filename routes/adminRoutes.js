import express from "express";
import {
  getDashboardStats,
  getAllUsers,
  getSupplyPurchaseDetails,
  revokeProduct,
  reactivateProduct,
  getAllProducts,
  getUserById,
  updateUser,
  suspendUser,
  activateUser,
  deleteUser,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/adminController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes require authentication and admin role
router.use(protect);
router.use(authorize("admin"));

// Dashboard stats
router.get("/stats", getDashboardStats);

// User management
router.get("/users", getAllUsers);
router.get("/users/:id", getUserById);
router.put("/users/:id", updateUser);
router.put("/users/:id/suspend", suspendUser);
router.put("/users/:id/activate", activateUser);
router.delete("/users/:id", deleteUser);

// Supply and purchase details
router.get("/supply-purchase", getSupplyPurchaseDetails);

// Product management (moderation & CRUD)
router.get("/products", getAllProducts);
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);
router.put("/products/:id/revoke", revokeProduct);
router.put("/products/:id/reactivate", reactivateProduct);

export default router;
