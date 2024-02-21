// "use client";

// import React, { useEffect } from "react";
// import { useFormContext, Controller } from "react-hook-form";
// import Editor, { EditorProps } from "~/components/editor";

// interface RHFEditorProps extends EditorProps {
//   name: string;
//   helperText?: string;
// }

// const RHFEditor: React.FC<RHFEditorProps> = ({
//   name,
//   helperText,
//   ...other
// }) => {
//   const {
//     control,
//     watch,
//     setValue,
//     formState: { errors },
//   } = useFormContext();

//   interface FormValues {
//     [key: string]: string;
//   }

//   const values = watch() as FormValues;

//   useEffect(() => {
//     if (values[name] === "<p><br></p>") {
//       setValue(name, "", {
//         shouldValidate: true,
//       });
//     }
//   }, [name, setValue, values]);

//   const errorMessage = errors[name]?.message;

//   return (
//     <div>
//       <Controller
//         name={name}
//         control={control}
//         render={({ field }) => (
//           <Editor
//             id={name}
//             value={field.value}
//             onChange={field.onChange}
//             {...other}
//           />
//         )}
//       />
//       {errorMessage && (
//         <p className="mt-2 text-sm text-red-600">{errorMessage.toString()}</p>
//       )}
//       {helperText && !errorMessage && (
//         <p className="mt-2 text-sm text-gray-600">{helperText}</p>
//       )}
//     </div>
//   );
// };

// export default RHFEditor;
