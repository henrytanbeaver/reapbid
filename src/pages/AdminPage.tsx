import React from 'react';
import AdminDashboard from '../components/Admin/AdminDashboard';
import Footer from '../components/Footer';

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <AdminDashboard />
      </div>
      <Footer />
    </div>
  );
}
