import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const OtpScreen: React.FC = () => {
    const navigate = useNavigate();

    useEffect(() => {
      navigate('/login', { replace: true });
    }, [navigate]);

    return null;
};

export default OtpScreen;
