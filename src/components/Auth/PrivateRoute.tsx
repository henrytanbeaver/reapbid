import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface PrivateRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin, isAdminLoading } = useAuth();
  const location = useLocation();

  // Wait for both auth and admin status check if needed
  if (loading || (adminOnly && isAdmin === undefined)) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check admin access for admin routes
  if (adminOnly && !isAdmin) {
    return <Navigate to="/home" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default PrivateRoute;
