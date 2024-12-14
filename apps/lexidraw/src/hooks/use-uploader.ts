// upload file hook

import { useState } from 'react';
import { api } from '~/trpc/react';

export const useUploader = () => {
  const [src, setSrc] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { mutate: generateUploadUrl } = api.entities.generateUploadUrl.useMutation();

  const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/avif'] as const;
  type AllowedType = typeof allowedTypes[number];

  const handleFileChange = (files: FileList | null, entityId: string) => {
    if (files && files.length > 0 && files[0]) {
      const file = files[0];
      if (file.size > 1024 * 1024) {
        setError('File size should be less than 1MB');
      } else if (allowedTypes.indexOf(file.type as AllowedType) === -1) {
        setError('File type should be image/png, image/jpeg, image/jpg');
      } else {
        generateUploadUrl({ entityId, contentType: file.type as AllowedType, mode: 'direct' }, {
          onSuccess: async (res) => {
            await fetch(res.signedUploadUrl, {
              method: 'PUT',
              body: file,
            });
            setSrc(res.signedDownloadUrl);
            console.log("res.signedDownloadUrl", res.signedDownloadUrl);
          },
        });

        setError(null);
      }
    }
  };

  return { src, error, handleFileChange };
};