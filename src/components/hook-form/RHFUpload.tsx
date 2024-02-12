// "use client"

// import React from "react";
// import { useFormContext, Controller } from "react-hook-form";
// import { UploadAvatar, Upload, UploadBox, UploadProps } from "~/components/upload";

// interface RHFUploadProps extends Omit<UploadProps, "file"> {
//   name: string;
//   multiple?: boolean;
//   helperText?: React.ReactNode;
// }

// export function RHFUploadAvatar({ name, ...other }: RHFUploadProps) {
//   const { control } = useFormContext();

//   return (
//     <Controller
//       name={name}
//       control={control}
//       render={({ field, fieldState: { error } }) => (
//         <div>
//           <UploadAvatar
//             accept={{ "image/*": [] }}
//             error={!!error}
//             file={field.value}
//             {...other}
//           />
//           {error && (
//             <p className="mt-2 text-sm text-red-600">{error.message}</p>
//           )}
//         </div>
//       )}
//     />
//   );
// }

// export function RHFUploadBox({ name, ...other }: RHFUploadProps) {
//   const { control } = useFormContext();

//   return (
//     <Controller
//       name={name}
//       control={control}
//       render={({ field, fieldState: { error } }) => (
//         <UploadBox files={field.value} error={!!error} {...other} />
//       )}
//     />
//   );
// }

// export function RHFUpload({
//   name,
//   multiple,
//   helperText,
//   ...other
// }: RHFUploadProps) {
//   const { control } = useFormContext();

//   return (
//     <Controller
//       name={name}
//       control={control}
//       render={({ field, fieldState: { error } }) => (
//         <div>
//           <Upload
//             multiple={multiple}
//             accept={{ "image/*": [] }}
//             files={multiple ? field.value : undefined}
//             file={!multiple ? field.value : undefined}
//             error={!!error}
//             {...other}
//           />
//           {(error || helperText) && (
//             <p
//               className={`mt-2 text-sm ${
//                 error ? "text-red-600" : "text-gray-600"
//               }`}
//             >
//               {error ? error.message : helperText}
//             </p>
//           )}
//         </div>
//       )}
//     />
//   );
// }
