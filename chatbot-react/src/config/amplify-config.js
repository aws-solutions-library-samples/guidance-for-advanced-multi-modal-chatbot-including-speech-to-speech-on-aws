import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: process.env.REACT_APP_AWS_REGION,
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
    identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
  },
  Storage: {
    AWSS3: {
        bucket: process.env.REACT_APP_S3_SOURCE, 
        region: process.env.REACT_APP_AWS_REGION,
        identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID
    }
  },
  CloudFront: {
    domainName: process.env.REACT_APP_CLOUDFRONT_DOMAIN_NAME
  }
});

export const getCloudFrontDomain = () => process.env.REACT_APP_CLOUDFRONT_DOMAIN_NAME;